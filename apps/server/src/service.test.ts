import { expect, test } from "bun:test";

import {
  isBunRuntime,
  launchdPlist,
  plistPath,
  runService,
  type ServiceDeps,
  systemdUnit,
  unitPath,
} from "./service.ts";

function fake(platform: string, overrides: Partial<ServiceDeps> = {}) {
  const commands: string[][] = [];
  const written = new Map<string, string>();
  const removed: string[] = [];
  const deps: ServiceDeps = {
    platform,
    home: "/home/amy",
    uid: 501,
    execPath: "/usr/local/bin/headroom",
    path: "/usr/bin:/opt/bin",
    logDir: "/home/amy/logs",
    run: (command) => {
      commands.push([...command]);
      return { code: 0, output: "" };
    },
    writeFile: (path, content) => void written.set(path, content),
    removeFile: (path) => void removed.push(path),
    exists: (path) => written.has(path),
    ...overrides,
  };
  return { deps, commands, written, removed };
}

test("launchd plist runs the binary at load and keeps it alive", () => {
  const plist = launchdPlist("/opt/h&h/headroom", "/logs/headroom.log", "/usr/bin");
  expect(plist).toContain("<string>club.theblank.headroom</string>");
  expect(plist).toContain("<string>/opt/h&amp;h/headroom</string>\n    <string>start</string>");
  expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
  expect(plist).toContain("<key>StandardErrorPath</key>\n  <string>/logs/headroom.log</string>");
  expect(plist).toContain("<key>PATH</key>");
  expect(launchdPlist("/h", "/l", undefined)).not.toContain("EnvironmentVariables");
});

test("systemd unit restarts on failure", () => {
  const unit = systemdUnit("/usr/local/bin/headroom", "/usr/bin");
  expect(unit).toContain('ExecStart="/usr/local/bin/headroom" start');
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain('Environment="PATH=/usr/bin"');
});

test("macOS install writes the plist then bootstraps it", () => {
  const { deps, commands, written } = fake("darwin");
  const outcome = runService("install", deps);
  expect(outcome.code).toBe(0);
  expect(written.get(plistPath("/home/amy"))).toContain("ProgramArguments");
  expect(written.get(plistPath("/home/amy"))).toContain("/home/amy/logs/headroom.log");
  expect(commands.at(-1)).toEqual([
    "launchctl",
    "bootstrap",
    "gui/501",
    "/home/amy/Library/LaunchAgents/club.theblank.headroom.plist",
  ]);
});

test("macOS uninstall boots out and deletes the plist", () => {
  const { deps, commands, written, removed } = fake("darwin");
  written.set(plistPath("/home/amy"), "x");
  expect(runService("uninstall", deps).code).toBe(0);
  expect(commands).toEqual([["launchctl", "bootout", "gui/501/club.theblank.headroom"]]);
  expect(removed).toEqual([plistPath("/home/amy")]);
});

test("Linux install enables the user unit and hints about linger", () => {
  const { deps, commands, written } = fake("linux");
  const outcome = runService("install", deps);
  expect(written.get(unitPath("/home/amy"))).toContain("ExecStart=");
  expect(commands).toEqual([
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", "headroom"],
  ]);
  expect(outcome.lines.join("\n")).toContain("enable-linger");
});

test("status reports installed and running", () => {
  const { deps, written } = fake("linux");
  expect(runService("status", deps).lines).toEqual(["installed: false", "running: false"]);
  written.set(unitPath("/home/amy"), "x");
  expect(runService("status", deps).lines).toEqual(["installed: true", "running: true"]);
});

test("install refuses to run under bun and failures surface", () => {
  const bun = fake("darwin", { execPath: "/opt/homebrew/bin/bun" });
  expect(runService("install", bun.deps).code).toBe(1);
  expect(bun.commands).toEqual([]);
  expect(bun.written.size).toBe(0);
  expect(isBunRuntime("/x/headroom")).toBe(false);
  const failing = fake("linux", { run: () => ({ code: 1, output: "no bus" }) });
  expect(runService("install", failing.deps).lines[0]).toContain("no bus");
  expect(runService("install", fake("win32").deps).code).toBe(1);
});
