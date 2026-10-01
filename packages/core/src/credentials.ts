import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Keyring, openJson, sealJson } from "./crypto/index.ts";
import { type Db, schema } from "./db/index.ts";
import type { RefreshState } from "./enums.ts";

/**
 * One encrypted credential record per connection. The connector is its only
 * writer, under the connection lease. Plaintext never leaves this module except
 * to the connector that owns the connection.
 */

export const storedCredentialSchema = z.object({
  /** Provider-specific secret material: tokens, key, client id. Opaque to the application. */
  secret: z.record(z.string(), z.unknown()),
  /** Epoch ms when the access credential stops working, if the provider says. */
  expiresAt: z.number().int().nullable(),
});
export type StoredCredential = z.infer<typeof storedCredentialSchema>;

export interface CredentialRecord extends StoredCredential {
  readonly connectionId: string;
  readonly refreshState: RefreshState;
  readonly refreshedAt: Date | null;
  readonly keyVersion: number;
}

function aad(connectionId: string): string {
  return `credentials:${connectionId}`;
}

export class CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly keyring: Keyring,
  ) {}

  /** Insert or replace the connection's credential. `refreshState` defaults to fresh. */
  put(
    connectionId: string,
    credential: StoredCredential,
    refreshState: RefreshState = "fresh",
  ): void {
    const sealed = sealJson(
      this.keyring,
      storedCredentialSchema.parse(credential),
      aad(connectionId),
    );
    const now = new Date();
    this.db
      .insert(schema.credentials)
      .values({
        connectionId,
        ciphertext: Buffer.from(sealed.ciphertext),
        nonce: Buffer.from(sealed.nonce),
        keyVersion: sealed.keyVersion,
        expiresAt: credential.expiresAt === null ? null : new Date(credential.expiresAt),
        refreshedAt: now,
        refreshState,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.credentials.connectionId,
        set: {
          ciphertext: Buffer.from(sealed.ciphertext),
          nonce: Buffer.from(sealed.nonce),
          keyVersion: sealed.keyVersion,
          expiresAt: credential.expiresAt === null ? null : new Date(credential.expiresAt),
          refreshedAt: now,
          refreshState,
          updatedAt: now,
        },
      })
      .run();
  }

  get(connectionId: string): CredentialRecord | null {
    const row = this.db
      .select()
      .from(schema.credentials)
      .where(eq(schema.credentials.connectionId, connectionId))
      .get();
    if (!row) return null;
    const plain = storedCredentialSchema.parse(
      openJson(
        this.keyring,
        { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion },
        aad(connectionId),
      ),
    );
    return {
      connectionId,
      secret: plain.secret,
      expiresAt: plain.expiresAt,
      refreshState: row.refreshState,
      refreshedAt: row.refreshedAt,
      keyVersion: row.keyVersion,
    };
  }

  setRefreshState(connectionId: string, refreshState: RefreshState): void {
    this.db
      .update(schema.credentials)
      .set({ refreshState, updatedAt: new Date() })
      .where(eq(schema.credentials.connectionId, connectionId))
      .run();
  }

  delete(connectionId: string): void {
    this.db
      .delete(schema.credentials)
      .where(eq(schema.credentials.connectionId, connectionId))
      .run();
  }

  /** Re-encrypt every row not already under the current key. Returns the count re-sealed. */
  rotate(): number {
    const rows = this.db.select().from(schema.credentials).all();
    let count = 0;
    for (const row of rows) {
      if (row.keyVersion === this.keyring.currentVersion) continue;
      const plain = storedCredentialSchema.parse(
        openJson(
          this.keyring,
          { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion },
          aad(row.connectionId),
        ),
      );
      this.put(row.connectionId, plain, row.refreshState);
      count += 1;
    }
    return count;
  }
}
