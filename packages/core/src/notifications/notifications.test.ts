import { describe, expect, test } from "bun:test";

import { createKeyring, generateKeyHex, parseKeyHex } from "../crypto/index.ts";
import { openDatabase, schema } from "../db/index.ts";
import { ChannelStore, generateWebhookSecret } from "./channels.ts";
import { DeliveryStore } from "./deliveries.ts";

function setupRaw() {
  const { db, sqlite } = openDatabase({ path: ":memory:" });
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  return { sqlite, channels: new ChannelStore(db, keyring) };
}

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  return { db, channels: new ChannelStore(db, keyring), deliveries: new DeliveryStore(db) };
}

const telegram = { botToken: "123456:SYNTHETIC-token-value-0123456789abcdef", chatId: "-100123" };

describe("ChannelStore", () => {
  test("create seals the config and list never shows it", () => {
    const { db, channels } = setup();
    const channel = channels.create("telegram", telegram, {
      includeIdentity: false,
      label: "@synthetic_bot",
    });
    expect(channel.enabled).toBe(true);
    expect(JSON.stringify(channels.list())).not.toContain(telegram.botToken);
    expect(JSON.stringify(channels.list())).not.toContain(telegram.chatId);
    const raw = db.select().from(schema.notificationChannels).get();
    expect(Buffer.from(raw?.configCiphertext ?? []).toString("utf8")).not.toContain("SYNTHETIC");
    expect(channels.secretConfig(channel.id)).toEqual({ type: "telegram", ...telegram });
  });

  test("a sealed config is bound to its row", () => {
    const { sqlite, channels } = setupRaw();
    const a = channels.create("telegram", telegram, { includeIdentity: false, label: "a" });
    const b = channels.create("telegram", telegram, { includeIdentity: false, label: "b" });
    sqlite.run(
      "UPDATE notification_channels SET config_ciphertext = (SELECT config_ciphertext FROM notification_channels WHERE id = ?1), config_nonce = (SELECT config_nonce FROM notification_channels WHERE id = ?1) WHERE id = ?2",
      [a.id, b.id],
    );
    expect(() => channels.secretConfig(b.id)).toThrow();
  });

  test("update replaces config and flags, and returns null for an unknown id", () => {
    const { channels } = setup();
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    const channel = channels.create(
      "webhook",
      { url: "http://192.168.1.5/hook", secret },
      { includeIdentity: false, label: "192.168.1.5" },
    );
    const next = generateWebhookSecret();
    const updated = channels.update(channel.id, {
      enabled: false,
      includeIdentity: true,
      config: { url: "https://example.com/x", secret: next },
    });
    expect(updated?.enabled).toBe(false);
    expect(updated?.includeIdentity).toBe(true);
    expect(channels.secretConfig(channel.id)).toEqual({
      type: "webhook",
      url: "https://example.com/x",
      secret: next,
    });
    expect(channels.update("missing", { enabled: true })).toBeNull();
  });

  test("a config of the wrong shape is rejected", () => {
    const { channels } = setup();
    expect(() =>
      channels.create("webhook", telegram, { includeIdentity: false, label: "x" }),
    ).toThrow();
  });

  test("delete removes the channel and its deliveries", () => {
    const { db, channels, deliveries } = setup();
    const channel = channels.create("telegram", telegram, { includeIdentity: false, label: "a" });
    deliveries.recordAttempt({
      channelId: channel.id,
      eventId: "e1",
      kind: "running_low",
      status: "delivered",
      attempts: 1,
      failure: null,
      at: new Date(1000),
      nextAttemptAt: null,
    });
    expect(channels.delete(channel.id)).toBe(true);
    expect(channels.delete(channel.id)).toBe(false);
    expect(db.select().from(schema.notificationDeliveries).all()).toHaveLength(0);
  });
});

describe("DeliveryStore", () => {
  test("upsert keeps the first attempt time, and lastDelivery is the latest attempt", () => {
    const { channels, deliveries } = setup();
    const channel = channels.create("telegram", telegram, { includeIdentity: false, label: "a" });
    const base = { channelId: channel.id, kind: "running_low", nextAttemptAt: null };
    deliveries.recordAttempt({
      ...base,
      eventId: "e1",
      status: "retrying",
      attempts: 1,
      failure: "timeout",
      at: new Date(1000),
      nextAttemptAt: new Date(61_000),
    });
    deliveries.recordAttempt({
      ...base,
      eventId: "e1",
      status: "delivered",
      attempts: 2,
      failure: null,
      at: new Date(70_000),
    });
    const row = deliveries.get(channel.id, "e1");
    expect(row?.firstAttemptAt.getTime()).toBe(1000);
    expect(row?.status).toBe("delivered");
    expect(row?.deliveredAt?.getTime()).toBe(70_000);
    expect(row?.nextAttemptAt).toBeNull();
    deliveries.recordAttempt({
      ...base,
      eventId: "e2",
      status: "failed",
      attempts: 5,
      failure: "rejected",
      at: new Date(90_000),
    });
    expect(deliveries.lastDelivery(channel.id)).toEqual({
      status: "failed",
      at: new Date(90_000),
      failure: "rejected",
    });
    expect(deliveries.lastDelivery("none")).toBeNull();
  });

  test("prune deletes old rows only", () => {
    const { channels, deliveries } = setup();
    const channel = channels.create("telegram", telegram, { includeIdentity: false, label: "a" });
    for (const [eventId, ms] of [
      ["old", 1000],
      ["new", 9000],
    ] as const) {
      deliveries.recordAttempt({
        channelId: channel.id,
        eventId,
        kind: "running_low",
        status: "delivered",
        attempts: 1,
        failure: null,
        at: new Date(ms),
        nextAttemptAt: null,
      });
    }
    expect(deliveries.prune(new Date(5000))).toBe(1);
    expect(deliveries.get(channel.id, "old")).toBeNull();
    expect(deliveries.get(channel.id, "new")).not.toBeNull();
  });
});
