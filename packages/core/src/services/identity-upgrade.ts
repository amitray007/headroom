import type { Identity } from "../connector.ts";
import type { CredentialStore } from "../credentials.ts";
import type { ConnectionStore } from "../lifecycle.ts";
import type { ConnectorRegistry } from "./connect.ts";

export interface IdentityUpgradeOptions {
  readonly registry: ConnectorRegistry;
  readonly connections: ConnectionStore;
  readonly credentials: CredentialStore;
  readonly log: (level: "info" | "warn", message: string) => void;
}

/**
 * Move connections stored under an older identity key to the key their connector uses now, in
 * place, so each keeps its id, credential and history. Offline and idempotent; returns the count.
 */
export function upgradeIdentities(options: IdentityUpgradeOptions): number {
  let upgraded = 0;
  for (const row of options.connections.list()) {
    const connector = options.registry.get(row.provider);
    if (!connector?.upgradeIdentity) continue;
    const stored: Identity = {
      providerAccountId: row.providerAccountId,
      workspaceId: row.workspaceId,
      label: row.label,
      assurance: "strong",
    };
    let next: Identity | null;
    try {
      const record = options.credentials.get(row.id);
      if (!record) continue;
      next = connector.upgradeIdentity(
        { secret: record.secret, expiresAt: record.expiresAt },
        stored,
      );
    } catch {
      // The next collection or Reconnect reports an unreadable credential; startup goes on.
      options.log("warn", `identity upgrade skipped for connection ${row.id}`);
      continue;
    }
    if (!next) continue;
    const taken = options.connections.findByIdentity(row.provider, next, row.scope);
    if (taken && taken.id !== row.id) {
      options.log("warn", `identity upgrade skipped for connection ${row.id}: key in use`);
      continue;
    }
    options.connections.rekey(row.id, next);
    upgraded++;
  }
  if (upgraded > 0) options.log("info", `upgraded the identity key of ${upgraded} connection(s)`);
  return upgraded;
}
