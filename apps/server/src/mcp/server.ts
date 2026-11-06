import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { type HistoryReader, providerSchema } from "@headroom/core";
import { buildAnalytics, planFitOf } from "@headroom/view-model/analytics";
import { monthlyUsd } from "@headroom/view-model/wallet";

import type { AppContext } from "../bootstrap.ts";
import { overviewConnections } from "../overview-model.ts";
import { currentAppFeed, historyRequest, readHistory } from "../read-model.ts";
import { version } from "../version.ts";
import { formatHistory, formatStatus } from "./format.ts";

const instructions =
  "Read-only limits and usage of the owner's AI accounts, as last collected; the tools never refresh. Percentages are of each account's own limit. Times are relative to the call. unknown means not reported, never zero.";
const annotations = { readOnlyHint: true, openWorldHint: false, idempotentHint: true } as const;

const provider = providerSchema.optional().describe("Only this provider's accounts. Omit for all.");
const statusInput = z.object({ provider });
const historyInput = z.object({
  days: z
    .union([z.literal(7), z.literal(30), z.literal(90)])
    .default(30)
    .describe("Days to look back: 7, 30 or 90. A weekly limit needs 30 or more for a verdict."),
  provider,
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

function historyText(
  ctx: AppContext,
  reader: HistoryReader,
  input: z.infer<typeof historyInput>,
): string {
  const now = ctx.now().getTime();
  const connections = overviewConnections(ctx, now).filter(
    (connection) => input.provider === undefined || connection.provider === input.provider,
  );
  const costs = ctx.wallet.book().costs;
  const perUsd = ctx.exchangeRates.view().perUsd;
  const monthlyCosts = new Map(
    connections.map((connection) => [
      connection.id,
      monthlyUsd(costs[connection.id] ?? null, perUsd, false).usd,
    ]),
  );
  const request = historyRequest(ctx, now, input.days);
  const history = readHistory(ctx, reader, request, 0);
  const analytics = buildAnalytics(connections, history, now, input.days, monthlyCosts);
  // Plan fit leaves out paused and disconnected accounts, as the dashboard does.
  const accounts = analytics.accounts.filter((story) => !story.inactive);
  const fits = new Map(
    accounts.map((story) => [story.id, planFitOf(story, now, request.to - request.from)]),
  );
  return formatHistory({ ...analytics, accounts }, fits, input.days);
}

/** A fresh server per request: the tools are stateless reads of the shared context and history fold. */
export function createMcpServer(ctx: AppContext, reader: HistoryReader): McpServer {
  const server = new McpServer({ name: "headroom", version }, { instructions });
  server.registerTool(
    "status",
    {
      description:
        "Each account's limits now: percent left, reset time, when it runs out at the current pace, spend against caps, banked resets and the monthly plan total. Use it to pick an account with room.",
      inputSchema: statusInput,
      annotations,
    },
    (input) => text(formatStatus(currentAppFeed(ctx, ctx.now().getTime(), 0), input.provider)),
  );
  server.registerTool(
    "history",
    {
      description:
        "Each account's main limit over past windows: peak use per window (oldest first), times it hit the limit, early resets, and whether the plan is too small, fits or has room to spare.",
      inputSchema: historyInput,
      annotations,
    },
    (input) => text(historyText(ctx, reader, input)),
  );
  return server;
}
