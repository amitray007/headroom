import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

const launchdLabel = "club.theblank.headroom";

export type ServiceAction = "install" | "uninstall" | "status";

interface CommandResult {
  readonly code: number;
  readonly output: string;
}

/** Everything the service commands touch, injected so tests never run launchctl or write files. */
export interface ServiceDeps {
  readonly platform: string;
  readonly home: string;
  readonly uid: number;
  readonly execPath: string;
  /** PATH at install time, so the service can still find the sign-in CLIs. */
  readonly path: string | undefined;
  /** Parent of the data directory; the macOS log lives there. */
  readonly logDir: string;
  run(command: readonly string[]): CommandResult;
  writeFile(path: string, content: string): void;
  removeFile(path: string): void;
  exists(path: string): boolean;
}

export interface ServiceOutcome {
  readonly code: number;
  readonly lines: readonly string[];
}

const xmlEscape = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function plistPath(home: string): string {
  return `${home}/Library/LaunchAgents/${launchdLabel}.plist`;
}

export function unitPath(home: string): string {
  return `${home}/.config/systemd/user/headroom.service`;
}

export function launchdPlist(execPath: string, logPath: string, path: string | undefined): string {
  const env = path
    ? `  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(path)}</string>
  </dict>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(execPath)}</string>
    <string>start</string>
  </array>
${env}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
}

export function systemdUnit(execPath: string, path: string | undefined): string {
  const quoted = `"${execPath.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const env = path ? `Environment="PATH=${path.replaceAll('"', '\\"')}"\n` : "";
  return `[Unit]
Description=Headroom, AI account allowances dashboard
After=network-online.target

[Service]
ExecStart=${quoted} start
${env}Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** True when the running executable is the Bun runtime instead of the compiled binary. */
export function isBunRuntime(execPath: string): boolean {
  return /^bun(-debug)?$/.test(basename(execPath));
}

export function runService(action: ServiceAction, deps: ServiceDeps): ServiceOutcome {
  if (deps.platform !== "darwin" && deps.platform !== "linux") {
    return { code: 1, lines: [`service is not supported on ${deps.platform}`] };
  }
  if (action === "install" && isBunRuntime(deps.execPath)) {
    return {
      code: 1,
      lines: ["service install needs the compiled headroom binary, not bun. Run ./dist/headroom."],
    };
  }
  return deps.platform === "darwin" ? macService(action, deps) : linuxService(action, deps);
}

function macService(action: ServiceAction, deps: ServiceDeps): ServiceOutcome {
  const plist = plistPath(deps.home);
  const domain = `gui/${deps.uid}`;
  const target = `${domain}/${launchdLabel}`;
  if (action === "status") {
    const installed = deps.exists(plist);
    const running = installed && deps.run(["launchctl", "print", target]).code === 0;
    return { code: 0, lines: [`installed: ${installed}`, `running: ${running}`] };
  }
  if (action === "uninstall") {
    deps.run(["launchctl", "bootout", target]);
    if (deps.exists(plist)) deps.removeFile(plist);
    return { code: 0, lines: ["Headroom no longer starts at login."] };
  }
  deps.writeFile(plist, launchdPlist(deps.execPath, `${deps.logDir}/headroom.log`, deps.path));
  deps.run(["launchctl", "bootout", target]); // Reinstall: drop a loaded copy, ignore "not loaded".
  const result = deps.run(["launchctl", "bootstrap", domain, plist]);
  if (result.code !== 0) {
    return { code: 1, lines: [`launchctl bootstrap failed: ${result.output.trim()}`] };
  }
  return {
    code: 0,
    lines: [`Installed ${plist}`, `Headroom starts at login. Log: ${deps.logDir}/headroom.log`],
  };
}

function linuxService(action: ServiceAction, deps: ServiceDeps): ServiceOutcome {
  const unit = unitPath(deps.home);
  if (action === "status") {
    const installed = deps.exists(unit);
    const running =
      installed && deps.run(["systemctl", "--user", "is-active", "--quiet", "headroom"]).code === 0;
    return { code: 0, lines: [`installed: ${installed}`, `running: ${running}`] };
  }
  if (action === "uninstall") {
    deps.run(["systemctl", "--user", "disable", "--now", "headroom"]);
    if (deps.exists(unit)) deps.removeFile(unit);
    deps.run(["systemctl", "--user", "daemon-reload"]);
    return { code: 0, lines: ["Headroom no longer starts at login."] };
  }
  deps.writeFile(unit, systemdUnit(deps.execPath, deps.path));
  deps.run(["systemctl", "--user", "daemon-reload"]);
  const result = deps.run(["systemctl", "--user", "enable", "--now", "headroom"]);
  if (result.code !== 0) {
    return { code: 1, lines: [`systemctl enable failed: ${result.output.trim()}`] };
  }
  return {
    code: 0,
    lines: [
      `Installed ${unit}`,
      "Headroom starts at login. Logs: journalctl --user -u headroom",
      "On a headless server, run `loginctl enable-linger $USER` so it starts at boot without a login.",
    ],
  };
}

/** Real dependencies for the running machine. */
export function systemServiceDeps(
  base: Pick<ServiceDeps, "home" | "logDir" | "path">,
): ServiceDeps {
  return {
    ...base,
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    execPath: process.execPath,
    run(command) {
      try {
        const result = Bun.spawnSync([...command], { stdin: "ignore" });
        return {
          code: result.exitCode,
          output: `${result.stdout.toString()}${result.stderr.toString()}`,
        };
      } catch (error) {
        return { code: 127, output: error instanceof Error ? error.message : "command failed" };
      }
    },
    writeFile(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    removeFile: (path) => rmSync(path, { force: true }),
    exists: (path) => existsSync(path),
  };
}
