import type { HistoryReader } from "@headroom/core";
import { buildAppFeed } from "@headroom/view-model/app-feed";
import type { History } from "@headroom/view-model/history";

import type { AppContext } from "./bootstrap.ts";
import { overviewConnections } from "./overview-model.ts";
import { version } from "./version.ts";

const day = 86_400_000;
/** One history bucket: an hour. */
export const bucketMs = 3_600_000;

/** The longest history range any reader asks for; the shared reader keeps this much folded. */
export const historyKeepMs = 90 * day;

/** The app feed as of `now`, for the feed route and the MCP tools. */
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

/** Hourly history in hours that start on the `tzOffsetMinutes` boundaries. */
export function readHistory(
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
