import { createApp, version } from "./app.ts";

if (Bun.argv.includes("--version")) {
  process.stdout.write(`headroom ${version}\n`);
  process.exit(0);
}

const port = Number(Bun.env["HEADROOM_PORT"] ?? 8080);

export default {
  port,
  fetch: createApp().fetch,
};
