import type {
  ChannelConfig,
  ChannelRow,
  ChannelStore,
  DeliveryStore,
  NotificationDeliveryFailure,
  Settings,
  TopUp,
} from "@headroom/core";
import { type NotificationEvent, notificationEventSchema } from "@headroom/core/contracts";

import type { OverviewConnectionLike } from "../overview-model.ts";
import { telegramText } from "./format.ts";
import type { Fetch, SendResult } from "./http.ts";
import { telegramSend } from "./telegram.ts";
import { webhookMessageId, webhookSend } from "./webhook.ts";

/** Builds the events for the current overview. The coordinator wires the real derivation. */
export type DeriveNotifications = (
  connections: OverviewConnectionLike[],
  settings: Settings,
  now: number,
  topUps: readonly TopUp[],
) => NotificationEvent[];

export interface DispatcherOptions {
  readonly channels: ChannelStore;
  readonly deliveries: DeliveryStore;
  readonly overview: (now: number) => OverviewConnectionLike[];
  readonly settings: () => Settings;
  readonly derive: DeriveNotifications;
  /** The Wallet's top-ups, for expiry notices. Absent means none. */
  readonly topUps?: () => readonly TopUp[];
  /** The dashboard URL for the `links.dashboard` field, or null when the owner set no public URL. */
  readonly dashboardUrl: string | null;
  readonly fetch: Fetch;
  readonly log: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

export interface DispatchSummary {
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
}

/** Sends per pass. The rest wait for the next pass. */
export const maxSendsPerPass = 20;
const maxAttempts = 5;
/** Wait after failed attempt 1, 2, 3 and 4. */
const backoffMinutes = [1, 5, 15, 60] as const;
const retentionMs = 60 * 24 * 60 * 60 * 1000;

/**
 * Sends each current notification once to each enabled channel. The delivery record is the
 * dedupe key: delivered and failed events are skipped, a retrying one is resent when due. An
 * event the overview no longer derives is never sent again, so a notice that cleared stops retrying.
 */
export class NotificationDispatcher {
  private running = false;

  constructor(private readonly deps: DispatcherOptions) {}

  async dispatch(now: number): Promise<DispatchSummary> {
    const none: DispatchSummary = { sent: 0, delivered: 0, failed: 0 };
    if (this.running) return none;
    this.running = true;
    try {
      this.deps.deliveries.prune(new Date(now - retentionMs));
      const channels = this.deps.channels.list().filter((channel) => channel.enabled);
      if (channels.length === 0) return none;
      const connections = this.deps.overview(now);
      const identities = new Map(connections.map((c) => [c.id, c.identity]));
      const settings = { ...this.deps.settings(), timeStyle: "countdown" as const };
      const dashboardUrl = this.deps.dashboardUrl;
      const events = this.deps
        .derive(connections, settings, now, this.deps.topUps?.() ?? [])
        .map((event) =>
          dashboardUrl ? Object.assign({}, event, { links: { dashboard: dashboardUrl } }) : event,
        );
      let sent = 0;
      let delivered = 0;
      let failed = 0;
      for (const channel of channels) {
        const config = this.openConfig(channel);
        if (!config) continue;
        for (const base of events) {
          if (sent >= maxSendsPerPass) return { sent, delivered, failed };
          const event = withIdentity(base, channel, identities.get(base.connection.id) ?? null);
          const parsed = notificationEventSchema.safeParse(event);
          if (!parsed.success) {
            this.deps.log("warn", `dropped an invalid ${base.kind} notification event`);
            continue;
          }
          const record = this.deps.deliveries.get(channel.id, event.id);
          if (record?.status === "delivered" || record?.status === "failed") continue;
          if (record && record.nextAttemptAt && record.nextAttemptAt.getTime() > now) continue;
          sent += 1;
          // Sequential on purpose: one receiver request at a time.
          // eslint-disable-next-line no-await-in-loop -- sends must not run concurrently
          const result = await this.send(channel.id, config, parsed.data, now);
          const attempts = (record?.attempts ?? 0) + 1;
          const status = result.ok ? "delivered" : attempts >= maxAttempts ? "failed" : "retrying";
          if (status === "delivered") delivered += 1;
          if (status === "failed") failed += 1;
          const failure = result.ok ? null : result.failure;
          this.deps.deliveries.recordAttempt({
            channelId: channel.id,
            eventId: event.id,
            kind: event.kind,
            status,
            attempts,
            failure,
            at: new Date(now),
            nextAttemptAt:
              status === "retrying" ? new Date(now + retryDelayMs(attempts, result)) : null,
          });
          this.deps.log(
            status === "delivered" ? "info" : "warn",
            `notification ${event.kind} to channel ${channel.id}: ${status}${failure ? ` (${failure})` : ""}`,
          );
        }
      }
      return { sent, delivered, failed };
    } finally {
      this.running = false;
    }
  }

  private openConfig(channel: ChannelRow): ChannelConfig | null {
    try {
      return this.deps.channels.secretConfig(channel.id);
    } catch {
      this.deps.log("error", `channel ${channel.id}: stored config unreadable`);
      return null;
    }
  }

  private send(
    channelId: string,
    config: ChannelConfig,
    event: NotificationEvent,
    now: number,
  ): Promise<SendResult> {
    if (config.type === "telegram")
      return telegramSend(this.deps.fetch, config, telegramText(event));
    return webhookSend(
      this.deps.fetch,
      config,
      { type: "notification", id: webhookMessageId(channelId, event.id), event },
      now,
    );
  }
}

function withIdentity(
  event: NotificationEvent,
  channel: ChannelRow,
  identity: string | null,
): NotificationEvent {
  const { identity: _dropped, ...connection } = event.connection;
  return {
    ...event,
    connection: channel.includeIdentity && identity ? { ...connection, identity } : connection,
  };
}

/** Delay after failed attempt `attempts`: 1, 5, 15, 60 minutes. A longer Telegram retry_after wins. */
export function retryDelayMs(
  attempts: number,
  result: { ok: boolean; failure?: NotificationDeliveryFailure; retryAfterSeconds?: number },
): number {
  const base =
    (backoffMinutes[attempts - 1] ?? backoffMinutes[backoffMinutes.length - 1] ?? 60) * 60_000;
  const asked = result.retryAfterSeconds === undefined ? 0 : result.retryAfterSeconds * 1000;
  return Math.max(base, asked);
}
