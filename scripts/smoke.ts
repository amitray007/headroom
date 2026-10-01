/**
 * End-to-end smoke against the compiled binary: start it, sign up an owner,
 * begin a Codex CLI login (anonymous device-code request, no sign-in), check the
 * attempt shows a URL and code, cancel it, and confirm the attempt directory is gone.
 * Run with `mise run smoke`. Needs network access to auth.openai.com and a `codex` on PATH.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 18_400 + Math.floor(Math.random() * 100);
const base = `http://localhost:${port}`;
const dir = mkdtempSync(join(tmpdir(), "headroom-smoke-"));
const server = Bun.spawn(["./dist/headroom"], {
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
});

function step(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) throw new Error(name);
}

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
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

  const providers = await (await fetch(`${base}/api/providers`, { headers })).json();
  step("codex enabled", JSON.stringify(providers).includes('"codex"'), JSON.stringify(providers));

  const begun = await fetch(`${base}/api/attempts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "codex", method: "cli_login" }),
  });
  const attempt = (await begun.json()) as {
    attempt: {
      id: string;
      state: string;
      nextStep: { kind: string; verificationUrl?: string; userCode?: string } | null;
      error: string | null;
    };
  };
  step(
    "attempt awaiting_user",
    attempt.attempt.state === "awaiting_user",
    `${attempt.attempt.state} ${attempt.attempt.error ?? ""}`,
  );
  step(
    "device step present",
    attempt.attempt.nextStep?.kind === "device_code",
    JSON.stringify(attempt.attempt.nextStep),
  );
  step(
    "code redacted here",
    Boolean(attempt.attempt.nextStep?.userCode),
    "code received, not printed",
  );
  const attemptDir = join(dir, "data", "attempts", attempt.attempt.id);
  step("attempt directory exists", existsSync(attemptDir));

  const polled = (await (
    await fetch(`${base}/api/attempts/${attempt.attempt.id}`, { headers })
  ).json()) as { attempt: { state: string } };
  step("poll keeps waiting", polled.attempt.state === "awaiting_user", polled.attempt.state);

  const cancelled = (await (
    await fetch(`${base}/api/attempts/${attempt.attempt.id}/cancel`, { method: "POST", headers })
  ).json()) as { attempt: { state: string } };
  step("cancel", cancelled.attempt.state === "cancelled", cancelled.attempt.state);
  await Bun.sleep(300);
  step(
    "attempt directory removed",
    !existsSync(attemptDir),
    existsSync(attemptDir) ? readdirSync(attemptDir).join(",") : "",
  );

  const connections = (await (await fetch(`${base}/api/connections`, { headers })).json()) as {
    connections: unknown[];
  };
  step("no connection created", connections.connections.length === 0);
  console.log("smoke passed");
} finally {
  server.kill();
  await server.exited;
  rmSync(dir, { recursive: true, force: true });
}
