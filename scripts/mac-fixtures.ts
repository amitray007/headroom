import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { kindSwitches } from "../packages/core/src/settings-schema.ts";
import { format } from "oxfmt";

import { appFeedSchema, buildAppFeed } from "../packages/view-model/src/app-feed.ts";
import { demoOverview } from "../packages/view-model/src/demo.ts";
import { demoWallet } from "../packages/view-model/src/wallet-demo.ts";

/** Fixed Demo Mode input, with account labels replaced before notice derivation. */
export function macFixture() {
  const now = Date.UTC(2026, 9, 29, 15);
  const demo = demoOverview(42, now);
  let quotaIndex = 0;
  const connections = demo.connections.map((account, index) => ({
    ...account,
    name: `Account ${index + 1}`,
    identity: `account-${index + 1}@example.invalid`,
    // Include an exhausted and an unknown limit without relying on a random demo reading.
    snapshot:
      account.snapshot === null
        ? null
        : {
            ...account.snapshot,
            metrics: account.snapshot.metrics.map((metric) => {
              if (metric.kind !== "quota_percentage") return metric;
              quotaIndex += 1;
              if (quotaIndex === 1) return { ...metric, valueNum: 100 };
              if (quotaIndex === 2)
                return { ...metric, valueNum: null, availability: "unknown" as const };
              return metric;
            }),
          },
  }));
  return buildAppFeed({
    connections,
    providerOrder: demo.providerOrder,
    serverVersion: "synthetic",
    generatedAt: now,
    refreshIntervalMs: 900_000,
    staleAfterMs: 1_800_000,
    dashboardUrl: "https://headroom.example.invalid",
    wallet: demoWallet(42, connections, now),
    rates: null,
    tzOffsetMinutes: 0,
    read: new Set(),
    settings: {
      limitsView: "left",
      lowThresholdPercent: 20,
      timeStyle: "exact",
      clock: "24h",
      notifications: {
        kinds: kindSwitches(true),
        includeSessions: true,
        resetLeadDays: 3,
        mutedProviders: [],
      },
    },
  });
}

if (import.meta.main) {
  const directory = fileURLToPath(
    new URL("../apps/macos/HeadroomKit/Tests/HeadroomKitTests/Fixtures/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  const feed = macFixture();
  for (const [name, value] of Object.entries({
    demo: feed,
    empty: { ...feed, accounts: [], notices: [] },
  })) {
    appFeedSchema.parse(value);
    const text = (
      await format(`${name}.json`, `${JSON.stringify(value, null, 2)}\n`, { printWidth: 100 })
    ).code;
    await writeFile(`${directory}${name}.json`, text);
  }
}
