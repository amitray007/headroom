import { homedir } from "node:os";
import { dirname } from "node:path";

import { createAntigravityConnector } from "@headroom/connector-antigravity";
import { createClaudeConnector } from "@headroom/connector-claude";
import { createCodexConnector } from "@headroom/connector-codex";
import { createCopilotConnector } from "@headroom/connector-copilot";
import { createCursorConnector } from "@headroom/connector-cursor";
import { createGrokConnector } from "@headroom/connector-grok";
import { createVercelConnector } from "@headroom/connector-vercel-ai-gateway";
import { baseUrl, loadConfig } from "@headroom/core";

import { openBrowser, parseArgs, pathsText, usageText } from "./cli.ts";
import { createApp, version } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";
import { Scheduler } from "./scheduler.ts";
import { runService, systemServiceDeps } from "./service.ts";

const parsed = parseArgs(Bun.argv.slice(2));
if (!parsed.ok) {
  const early = loadConfig(Bun.env);
  process.stderr.write(`headroom: ${parsed.error}\n\n${usageText(early)}`);
  process.exit(2);
}
const command = parsed.command;
if (command.kind === "version") {
  process.stdout.write(`headroom ${version}\n`);
  process.exit(0);
}

const loaded = loadConfig(Bun.env);
if (command.kind === "help") {
  process.stdout.write(usageText(loaded));
  process.exit(0);
}
if (command.kind === "paths") {
  process.stdout.write(pathsText(loaded));
  process.exit(0);
}
if (command.kind === "service") {
  const outcome = runService(
    command.action,
    systemServiceDeps({
      home: Bun.env["HOME"] || homedir(),
      logDir: dirname(loaded.dataDir),
      path: Bun.env["PATH"],
    }),
  );
  for (const line of outcome.lines) process.stdout.write(`${line}\n`);
  process.exit(outcome.code);
}

const config = {
  ...loaded,
  ...(command.port !== undefined ? { port: command.port } : {}),
  ...(command.host !== undefined ? { host: command.host } : {}),
};
const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const threshold = levels[config.logLevel];
const ctx = bootstrap({
  config,
  connectors: (runner) => [
    createCodexConnector({ runner, ...(config.codexBin ? { codexBinary: config.codexBin } : {}) }),
    createClaudeConnector({
      runner,
      ...(config.claudeBin ? { claudeBinary: config.claudeBin } : {}),
    }),
    createGrokConnector({ runner, ...(config.grokBin ? { grokBinary: config.grokBin } : {}) }),
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
  events: ctx.accountEvents,
  afterCollect: (connectionId, now) => ctx.autoReset.evaluate(connectionId, now),
  intervalMs: () => ctx.settings.get().refreshIntervalMinutes * 60_000,
  retentionDays: () => ctx.settings.get().historyRetentionDays,
  afterTick: (now) => ctx.dispatcher.dispatch(now).then(() => undefined),
  log: ctx.log,
});
scheduler.start();
// Fetches the Wallet's exchange rates now and every 24 hours.
ctx.exchangeRates.start();

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  // Production behaviour everywhere: no Bun error pages with stack traces.
  development: false,
  fetch: createApp(ctx).fetch,
});

ctx.log(
  "info",
  `headroom ${version} listening on ${config.host}:${config.port}; open ${baseUrl(config)}; data in ${config.dataDir}`,
);
if (command.open) openBrowser(baseUrl(config));

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
