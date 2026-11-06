import { createHistoryReader, type HistoryReader } from "@headroom/core";
import { buildAppFeed, buildAppStatus } from "@headroom/view-model/app-feed";
import type { History } from "@headroom/view-model/history";

import type { AppContext } from "./bootstrap.ts";
import { overviewConnections } from "./overview-model.ts";
import { version } from "./version.ts";

export const day = 86_400_000;
/** One history bucket: an hour. */
export const bucketMs = 3_600_000;

/** The longest history range any reader asks for; the shared reader keeps this much folded. */
export const historyKeepDays = 90;
const historyKeepMs = historyKeepDays * day;

/**
 * One history fold for the Analytics route and the MCP tools. The reader folds once per time zone, so MCP,
 * which has no zone of its own, reads in the zone the dashboard asked for last and reuses that fold.
 */
export interface SharedHistory {
  readonly reader: HistoryReader;
  lastTzOffsetMinutes: number;
}

export function createSharedHistory(): SharedHistory {
  return { reader: createHistoryReader({ keepMs: historyKeepMs }), lastTzOffsetMinutes: 0 };
}

/** The app feed as of `now`, for the feed route. */
export function currentAppFeed(ctx: AppContext, now: number, tzOffsetMinutes: number) {
  const settings = ctx.settings.get();
  return buildAppFeed({
    connections: overviewConnections(ctx, now),
    providerOrder: ctx.order.providerOrder(),
    serverVersion: version,
    generatedAt: now,
    refreshIntervalMs: settings.refreshIntervalMinutes * 60_000,
    staleAfterMs: ctx.config.staleAfterSeconds * 1000,
    dashboardUrl: ctx.config.publicUrl ?? null,
    settings,
    wallet: { ...ctx.wallet.book(), displayCurrency: settings.walletCurrency },
    rates: ctx.exchangeRates.view().perUsd,
    tzOffsetMinutes,
    read: new Set(ctx.noticeReads.list()),
  });
}

/** The feed's accounts and summary as of `now`, without notices, for the MCP status tool. */
export function currentAppStatus(ctx: AppContext, now: number) {
  const settings = ctx.settings.get();
  return {
    ...buildAppStatus({
      connections: overviewConnections(ctx, now),
      providerOrder: ctx.order.providerOrder(),
      generatedAt: now,
      wallet: { ...ctx.wallet.book(), displayCurrency: settings.walletCurrency },
      rates: ctx.exchangeRates.view().perUsd,
    }),
    generatedAt: now,
    staleAfterMs: ctx.config.staleAfterSeconds * 1000,
  };
}

export interface HistoryRequest {
  readonly from: number;
  readonly to: number;
  readonly retentionDays: number;
  /** Every account in overview order. */
  readonly connectionIds: readonly string[];
}

export function historyRequest(ctx: AppContext, to: number, days: number): HistoryRequest {
  return {
    from: to - days * day,
    to,
    retentionDays: ctx.settings.get().historyRetentionDays,
    connectionIds: ctx.order.arrange(ctx.connections.list()).map((row) => row.id),
  };
}

/** Hourly history from the shared fold, in hours that start on the `tzOffsetMinutes` boundaries. */
export function readHourlyHistory(
  ctx: AppContext,
  reader: HistoryReader,
  request: HistoryRequest,
  tzOffsetMinutes: number,
): History {
  const { from, to, retentionDays, connectionIds } = request;
  return {
    from,
    to,
    bucketMs,
    retentionDays,
    connections: reader.read(ctx.db, {
      from,
      to,
      bucketMs,
      tzOffsetMinutes,
      connectionIds,
    }),
  };
}
