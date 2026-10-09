#!/usr/bin/env node
"use strict";
// Starts the native headroom binary from the platform package. Plain Node, no dependencies.
const { spawn } = require("node:child_process");

const platforms = {
  "darwin-arm64": "headroomhq-darwin-arm64",
  "darwin-x64": "headroomhq-darwin-x64",
  "linux-x64": "headroomhq-linux-x64",
  "linux-arm64": "headroomhq-linux-arm64",
};
const installer = "curl -fsSL https://headroom.theblank.club/install.sh | sh";

function fail(message) {
  process.stderr.write(`headroom: ${message}\nInstall the binary directly instead: ${installer}\n`);
  process.exit(1);
}

const key = `${process.platform}-${process.arch}`;
const pkg = platforms[key];
if (pkg === undefined) {
  fail(`no prebuilt binary for ${key}. Supported: ${Object.keys(platforms).join(", ")}.`);
}

let binary;
try {
  binary = require.resolve(`${pkg}/bin/headroom`);
} catch {
  fail(
    `the package ${pkg} is not installed. It is an optional dependency of headroomhq, ` +
      "so it is missing when you install with --no-optional or --omit=optional.",
  );
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
const forwarded = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of forwarded) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => fail(`cannot start ${binary}: ${error.message}`));
child.on("exit", (code, signal) => {
  if (signal !== null) {
    for (const name of forwarded) process.removeAllListeners(name);
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
