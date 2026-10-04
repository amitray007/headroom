import { createAntigravityConnector } from "@headroom/connector-antigravity";
import { createClaudeConnector } from "@headroom/connector-claude";
import { createCodexConnector } from "@headroom/connector-codex";
import { createCopilotConnector } from "@headroom/connector-copilot";
import { createCursorConnector } from "@headroom/connector-cursor";
import { createGrokConnector } from "@headroom/connector-grok";
import { createVercelConnector } from "@headroom/connector-vercel-ai-gateway";
import { loadConfig } from "@headroom/core";

import { createApp, version } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";
import { Scheduler } from "./scheduler.ts";

if (Bun.argv.includes("--version")) {
  process.stdout.write(`headroom ${version}\n`);
  process.exit(0);
}

const config = loadConfig(Bun.env);
const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const threshold = levels[config.logLevel];
const ctx = bootstrap({
  config,
  connectors: (runner) => [
    createCodexConnector({ runner }),
    createClaudeConnector({ runner }),
    createGrokConnector({ runner }),
    createAntigravityConnector(),
    createCopilotConnector(),
    createCursorConnector(),
    createVercelConnector(),
  ],
  log: (level, message) => {
    if (levels[level] < threshold) return;
    process.stderr.write(`${new Date().toISOString()} ${level} ${message}\n`);
  },
});
ctx.log("info", `headroom ${version} listening on :${config.port}, data in ${config.dataDir}`);
ctx.log(
  "info",
  `enabled providers: ${
    ctx.registry
      .list()
      .map((c) => c.provider)
      .join(", ") || "none"
  }`,
);

const scheduler = new Scheduler({
  connections: ctx.connections,
  attempts: ctx.attempts,
  connect: ctx.connect,
  snapshots: ctx.snapshots,
  collection: ctx.collection,
  intervalMs: () => ctx.settings.get().refreshIntervalMinutes * 60_000,
  afterTick: (now) => ctx.dispatcher.dispatch(now).then(() => undefined),
  log: ctx.log,
});
scheduler.start();
// Fetches the Wallet's exchange rates now and every 24 hours.
ctx.exchangeRates.start();

const server = Bun.serve({
  port: config.port,
  // Production behaviour everywhere: no Bun error pages with stack traces.
  development: false,
  fetch: createApp(ctx).fetch,
});

/** How long shutdown waits for the tick in flight, and then for open requests. Compose gives 20 s. */
const drainMs = 10_000;
const requestDrainMs = 5_000;
let shuttingDown = false;

/** Let a refresh in flight finish, so a rotated token is not lost, then close down in order. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  ctx.log("info", `received ${signal}, shutting down`);
  ctx.exchangeRates.stop();
  try {
    const drained = await Promise.race([
      scheduler.stop().then(() => true),
      Bun.sleep(drainMs).then(() => false),
    ]);
    if (!drained) ctx.log("warn", "a collection was still running at shutdown; leaving it");
    await Promise.race([server.stop(), Bun.sleep(requestDrainMs)]);
    ctx.sqlite.close();
  } catch (error) {
    ctx.log("error", `shutdown failed: ${error instanceof Error ? error.name : "unknown"}`);
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
