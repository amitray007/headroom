import { loadConfig } from "@headroom/core";

import { createApp, version } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";

if (Bun.argv.includes("--version")) {
  process.stdout.write(`headroom ${version}\n`);
  process.exit(0);
}

const config = loadConfig(Bun.env);
const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const threshold = levels[config.logLevel];
const ctx = bootstrap({
  config,
  log: (level, message) => {
    if (levels[level] < threshold) return;
    process.stderr.write(`${new Date().toISOString()} ${level} ${message}\n`);
  },
});
ctx.log("info", `headroom ${version} listening on :${config.port}, data in ${config.dataDir}`);

export default {
  port: config.port,
  fetch: createApp(ctx).fetch,
};
