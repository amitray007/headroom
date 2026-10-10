/**
 * End-to-end smoke of the sign-in CLIs: sign up an owner, then for each provider begin a CLI login,
 * check the attempt shows its next step (a device code, or an authorization URL for Claude), cancel
 * it, and confirm no connection was created. Nothing signs in: Codex and Grok request an anonymous
 * device code, and Claude only prints its authorization URL.
 *
 *   bun scripts/smoke.ts [provider...]   start ./dist/headroom and test the providers (default: codex)
 *   HEADROOM_SMOKE_URL=http://host:port bun scripts/smoke.ts codex claude grok
 *                                        test a running server, such as the image (image.yml)
 *
 * `mise run smoke` runs the first form. Needs network access to each provider's sign-in host and its
 * CLI on PATH (inside the image, the CLIs are already there).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Expected = "device_code" | "paste_redirect";
const EXPECTED: Record<string, Expected> = {
  codex: "device_code",
  grok: "device_code",
  claude: "paste_redirect",
};
/** A device code waits for the person to approve it elsewhere; a pasted redirect waits for their input. */
const WAITING: Record<Expected, string> = {
  device_code: "awaiting_user",
  paste_redirect: "awaiting_input",
};

const requested = process.argv.slice(2);
const providers = requested.length > 0 ? requested : ["codex"];
for (const provider of providers) {
  if (!(provider in EXPECTED)) throw new Error(`no CLI login to smoke for ${provider}`);
}

const external = process.env["HEADROOM_SMOKE_URL"];
const port = 18_400 + Math.floor(Math.random() * 100);
const base = external ?? `http://localhost:${port}`;
const dir = external ? undefined : mkdtempSync(join(tmpdir(), "headroom-smoke-"));
const server = dir
  ? Bun.spawn(["./dist/headroom"], {
      env: {
        ...process.env,
        HEADROOM_PORT: String(port),
        HEADROOM_DATA_DIR: join(dir, "data"),
        HEADROOM_MASTER_KEY_FILE: join(dir, "master.key"),
        HEADROOM_AUTH_SECRET_FILE: join(dir, "auth.secret"),
        HEADROOM_LOG_LEVEL: "debug",
      },
      stdout: "inherit",
      stderr: "inherit",
    })
  : undefined;

function step(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) throw new Error(name);
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
}

interface Attempt {
  attempt: {
    id: string;
    state: string;
    nextStep: { kind: string; url?: string; verificationUrl?: string; userCode?: string } | null;
    error: string | null;
  };
}

async function smokeLogin(provider: string, headers: Record<string, string>): Promise<void> {
  const expected = EXPECTED[provider];
  const waiting = WAITING[expected];
  const begun = await fetch(`${base}/api/attempts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider, method: "cli_login" }),
  });
  const { attempt } = (await begun.json()) as Attempt;
  step(
    `${provider}: attempt ${waiting}`,
    attempt.state === waiting,
    `${attempt.state} ${attempt.error ?? ""}`,
  );
  step(
    `${provider}: ${expected} step`,
    attempt.nextStep?.kind === expected,
    attempt.nextStep?.kind,
  );
  if (expected === "device_code") {
    // The code is a live one-time code: check it exists, never print it.
    step(`${provider}: code received`, Boolean(attempt.nextStep?.userCode), "not printed");
  } else {
    step(
      `${provider}: authorization URL`,
      Boolean(attempt.nextStep?.url?.startsWith("https://")),
      attempt.nextStep?.url ? new URL(attempt.nextStep.url).host : "",
    );
  }
  const attemptDir = dir ? join(dir, "data", "attempts", attempt.id) : undefined;
  if (attemptDir) step(`${provider}: attempt directory exists`, existsSync(attemptDir));

  const polled = (await (
    await fetch(`${base}/api/attempts/${attempt.id}`, { headers })
  ).json()) as Attempt;
  step(`${provider}: poll keeps waiting`, polled.attempt.state === waiting, polled.attempt.state);

  const cancelled = (await (
    await fetch(`${base}/api/attempts/${attempt.id}/cancel`, { method: "POST", headers })
  ).json()) as Attempt;
  step(`${provider}: cancel`, cancelled.attempt.state === "cancelled", cancelled.attempt.state);
  if (attemptDir) {
    await Bun.sleep(300);
    step(
      `${provider}: attempt directory removed`,
      !existsSync(attemptDir),
      existsSync(attemptDir) ? readdirSync(attemptDir).join(",") : "",
    );
  }
}

try {
  await waitForHealth();
  step("health", true);
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      name: "Smoke",
      email: "smoke@example.com",
      username: "smoke",
      password: "smoke test password 1",
    }),
  });
  step("owner sign-up", signUp.status === 200, String(signUp.status));
  const cookie = signUp.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const headers = { "content-type": "application/json", origin: base, cookie };

  const enabled = JSON.stringify(await (await fetch(`${base}/api/providers`, { headers })).json());
  for (const provider of providers) {
    const found = enabled.includes(`"provider":"${provider}"`);
    step(`${provider} enabled`, found, found ? "" : enabled);
    await smokeLogin(provider, headers);
  }

  const connections = (await (await fetch(`${base}/api/connections`, { headers })).json()) as {
    connections: unknown[];
  };
  step("no connection created", connections.connections.length === 0);
  console.log("smoke passed");
} finally {
  if (server) {
    server.kill();
    await server.exited;
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
}
