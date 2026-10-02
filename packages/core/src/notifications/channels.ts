import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Keyring, openJson, sealJson } from "../crypto/index.ts";
import { type Db, schema } from "../db/index.ts";
import type { NotificationChannelType } from "../enums.ts";

/**
 * Where server-side notifications go. Bot tokens, chat ids, webhook URLs and signing secrets are
 * sealed under the keyring, bound to their row. Only `secretConfig` opens them, and only the
 * senders call it. `label` is a display summary that never holds a secret.
 */

export const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

export const webhookConfigSchema = z.object({
  url: z.string().min(1),
  /** Standard Webhooks style: `whsec_` followed by base64. */
  secret: z.string().min(1),
});
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

export type ChannelConfig =
  | ({ readonly type: "telegram" } & TelegramConfig)
  | ({ readonly type: "webhook" } & WebhookConfig);

const configSchemas = { telegram: telegramConfigSchema, webhook: webhookConfigSchema } as const;

export interface ChannelRow {
  readonly id: string;
  readonly type: NotificationChannelType;
  readonly enabled: boolean;
  readonly includeIdentity: boolean;
  readonly label: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ChannelOptions {
  readonly includeIdentity: boolean;
  readonly label: string;
}

export interface ChannelUpdate {
  readonly enabled?: boolean;
  readonly includeIdentity?: boolean;
  readonly label?: string;
  /** Replaces the whole sealed config. Its type must match the channel's type. */
  readonly config?: TelegramConfig | WebhookConfig;
}

/** A new signing secret: `whsec_` plus base64 of 24 random bytes. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64")}`;
}

/** A client-supplied signing secret: `whsec_` plus standard base64 that decodes to 24 bytes or more. */
export const webhookSecretSchema = z
  .string()
  .regex(/^whsec_[A-Za-z0-9+/]{32,}={0,2}$/)
  .refine((value) => Buffer.from(value.slice("whsec_".length), "base64").length >= 24);

function aad(id: string): string {
  return `notification_channel:${id}`;
}

export class ChannelStore {
  constructor(
    private readonly db: Db,
    private readonly keyring: Keyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(
    type: NotificationChannelType,
    config: TelegramConfig | WebhookConfig,
    options: ChannelOptions,
  ): ChannelRow {
    const id = Bun.randomUUIDv7();
    const sealed = sealJson(this.keyring, configSchemas[type].parse(config), aad(id));
    const at = this.now();
    this.db
      .insert(schema.notificationChannels)
      .values({
        id,
        type,
        includeIdentity: options.includeIdentity,
        label: options.label,
        configCiphertext: Buffer.from(sealed.ciphertext),
        configNonce: Buffer.from(sealed.nonce),
        keyVersion: sealed.keyVersion,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const row = this.get(id);
    if (!row) throw new Error("channel missing after insert");
    return row;
  }

  list(): ChannelRow[] {
    return this.db
      .select()
      .from(schema.notificationChannels)
      .orderBy(schema.notificationChannels.createdAt, schema.notificationChannels.id)
      .all()
      .map(toRow);
  }

  get(id: string): ChannelRow | null {
    const row = this.db
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, id))
      .get();
    return row ? toRow(row) : null;
  }

  /** Returns null for an unknown id. */
  update(id: string, patch: ChannelUpdate): ChannelRow | null {
    const current = this.get(id);
    if (!current) return null;
    const set: Partial<typeof schema.notificationChannels.$inferInsert> = {
      updatedAt: this.now(),
    };
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.includeIdentity !== undefined) set.includeIdentity = patch.includeIdentity;
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.config !== undefined) {
      const sealed = sealJson(
        this.keyring,
        configSchemas[current.type].parse(patch.config),
        aad(id),
      );
      set.configCiphertext = Buffer.from(sealed.ciphertext);
      set.configNonce = Buffer.from(sealed.nonce);
      set.keyVersion = sealed.keyVersion;
    }
    this.db
      .update(schema.notificationChannels)
      .set(set)
      .where(eq(schema.notificationChannels.id, id))
      .run();
    return this.get(id);
  }

  /** Deleting a channel deletes its delivery records. */
  delete(id: string): boolean {
    return (
      this.db
        .delete(schema.notificationChannels)
        .where(eq(schema.notificationChannels.id, id))
        .returning({ id: schema.notificationChannels.id })
        .all().length > 0
    );
  }

  /** The opened config, validated for the channel's type. Null for an unknown id. */
  secretConfig(id: string): ChannelConfig | null {
    const row = this.db
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, id))
      .get();
    if (!row) return null;
    const plain = openJson(
      this.keyring,
      { ciphertext: row.configCiphertext, nonce: row.configNonce, keyVersion: row.keyVersion },
      aad(id),
    );
    if (row.type === "telegram") return { type: "telegram", ...telegramConfigSchema.parse(plain) };
    return { type: "webhook", ...webhookConfigSchema.parse(plain) };
  }
}

function toRow(row: typeof schema.notificationChannels.$inferSelect): ChannelRow {
  return {
    id: row.id,
    type: row.type,
    enabled: row.enabled,
    includeIdentity: row.includeIdentity,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
