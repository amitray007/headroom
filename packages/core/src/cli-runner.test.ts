import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliLoginRunner, redactOutput, stripAnsi } from "./cli-runner.ts";

/** A stand-in CLI: prints a URL and code with ANSI colour, then writes auth.json when it reads "ok" on stdin. */
const fakeCli = `
const home = process.env["FAKE_HOME"];
process.stdout.write("\\u001B[94mhttps://example.com/device\\u001B[0m\\ncode \\u001B[1mABCD-EFGH\\u001B[0m\\n");
if (process.env["FAKE_SECRET_LEAK"]) process.stdout.write("leaked " + process.env["FAKE_SECRET_LEAK"] + "\\n");
const reader = process.stdin;
for await (const chunk of reader) {
  if (new TextDecoder().decode(chunk).trim() === "ok") {
    await Bun.write(home + "/auth.json", JSON.stringify({ tokens: { access_token: "a" } }));
    process.exit(0);
  }
}
`;

async function until(predicate: () => boolean, ms = 3000, start = Date.now()): Promise<void> {
  if (predicate()) return;
  if (Date.now() - start > ms) throw new Error("timed out waiting");
  await Bun.sleep(20);
  await until(predicate, ms, start);
}

describe("CliLoginRunner", () => {
  test("isolates the environment, captures stripped output, feeds stdin, reads credentials, cleans up", async () => {
    const base = mkdtempSync(join(tmpdir(), "headroom-runner-"));
    try {
      const script = join(base, "fake-cli.ts");
      writeFileSync(script, fakeCli);
      const runner = new CliLoginRunner({ attemptsDir: join(base, "attempts") });
      process.env["FAKE_SECRET_LEAK"] = "host-secret";
      runner.start({
        attemptId: "attempt-1",
        command: [process.execPath, script],
        homeVariable: "FAKE_HOME",
        credentialFile: "auth.json",
        timeoutMs: 10_000,
      });
      await until(() => (runner.status("attempt-1")?.output ?? "").includes("ABCD-EFGH"));
      const status = runner.status("attempt-1")!;
      expect(status.state).toBe("running");
      expect(status.output).toContain("https://example.com/device");
      expect(status.output).not.toContain("\u001B[");
      // The host environment is not inherited.
      expect(status.output).not.toContain("host-secret");
      expect(status.credentialsPresent).toBe(false);

      runner.write("attempt-1", "ok");
      await until(() => runner.status("attempt-1")?.state === "exited");
      expect(runner.status("attempt-1")?.credentialsPresent).toBe(true);
      expect(JSON.parse(runner.readCredentials("attempt-1") ?? "{}")).toEqual({
        tokens: { access_token: "a" },
      });
      const dir = runner.attemptDir("attempt-1");
      expect(existsSync(dir)).toBe(true);
      await runner.cleanup("attempt-1");
      expect(existsSync(dir)).toBe(false);
      expect(runner.status("attempt-1")).toBeNull();
    } finally {
      delete process.env["FAKE_SECRET_LEAK"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("times out and kills a CLI that never finishes; sweep removes leftovers", async () => {
    const base = mkdtempSync(join(tmpdir(), "headroom-runner-"));
    try {
      const script = join(base, "sleep.ts");
      writeFileSync(script, "await Bun.sleep(60_000);");
      const runner = new CliLoginRunner({ attemptsDir: join(base, "attempts") });
      runner.start({
        attemptId: "attempt-2",
        command: [process.execPath, script],
        homeVariable: "FAKE_HOME",
        credentialFile: "auth.json",
        timeoutMs: 200,
      });
      await until(() => runner.status("attempt-2")?.state === "timed_out");
      await runner.kill("attempt-2");
      writeFileSync(join(base, "attempts", "stale-dir-marker"), "x");
      const other = new CliLoginRunner({ attemptsDir: join(base, "attempts") });
      expect(other.sweep()).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(base, "attempts", "attempt-2"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("shadows open, xdg-open and security so a CLI neither opens a browser nor reaches a keychain", async () => {
    const base = mkdtempSync(join(tmpdir(), "headroom-runner-"));
    try {
      const script = join(base, "browser.ts");
      writeFileSync(
        script,
        `const open = Bun.spawnSync(["open", "https://example.com/authorize"]);
const xdg = Bun.spawnSync(["xdg-open", "https://example.com/authorize"]);
const find = Bun.spawnSync(["security", "find-generic-password", "-a", "u", "-w", "-s", "svc"]);
const add = Bun.spawnSync(["security", "-i"], { stdin: Buffer.from("add-generic-password -U -a u -s svc -X 00\\n") });
process.stdout.write(\`open=\${open.exitCode} xdg=\${xdg.exitCode} find=\${find.exitCode} add=\${add.exitCode} out=\${add.stdout.length + add.stderr.length} which=\${Bun.which("open")} browser=\${process.env["BROWSER"]}\\n\`);`,
      );
      const runner = new CliLoginRunner({ attemptsDir: join(base, "attempts") });
      runner.start({
        attemptId: "attempt-3",
        command: [process.execPath, script],
        homeVariable: "FAKE_HOME",
        credentialFile: "auth.json",
        timeoutMs: 10_000,
      });
      await until(() => runner.status("attempt-3")?.state === "exited");
      const shim = join(runner.attemptDir("attempt-3"), "bin", "open");
      expect(runner.status("attempt-3")?.output.trim()).toBe(
        `open=0 xdg=0 find=44 add=1 out=0 which=${shim} browser=${shim}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("rejects unsafe attempt ids and strips ANSI", () => {
    const runner = new CliLoginRunner({ attemptsDir: "/tmp/never-used" });
    expect(() => runner.attemptDir("../etc")).toThrow();
    expect(stripAnsi("\u001B[94mhttps://x\u001B[0m \u001B[1;32mok\u001B[0m")).toBe("https://x ok");
  });
});

describe("redactOutput", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlLXN5bnRoZXRpYw";

  test("masks bearer tokens, JWTs, long hex and base64 secrets, and token members", () => {
    const text = [
      "Authorization: Bearer abc123.def456-ghi789",
      `id ${jwt}`,
      "key 0123456789abcdef0123456789abcdef0123",
      "blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5",
      '{"access_token": "synthetic-a", "refresh_token":"synthetic-r", "expires_in": 3600}',
      "id_token=synthetic-i&next=1",
    ].join("\n");
    const out = redactOutput(text);
    for (const secret of [
      "abc123.def456",
      "eyJhbGci",
      "0123456789abcdef0123456789abcdef0123",
      "QUJDREVG",
      "synthetic-a",
      "synthetic-r",
      "synthetic-i",
    ])
      expect(out).not.toContain(secret);
    expect(out).toContain("Bearer [redacted]");
    expect(out).toContain('"expires_in": 3600');
    expect(out).toContain("&next=1");
  });

  test("keeps sign-in URLs and user codes whole", () => {
    const claude =
      "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&state=dGhpc2lzYXN5bnRoZXRpY3N0YXRlMDEyMzQ1Njc4OWFiY2RlZg&code_challenge=Zm9vYmFyYmF6cXV4c3ludGhldGljY2hhbGxlbmdlMDEyMw";
    const grok = "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH";
    const text = `visit: ${claude}\n${grok}\ncode ABCD-1234`;
    expect(redactOutput(text)).toBe(text);
  });

  test("masks a token member inside a URL but leaves the rest of it", () => {
    expect(redactOutput("see https://x.test/cb?access_token=synthetic&state=keep")).toBe(
      "see https://x.test/cb?access_token=[redacted]&state=keep",
    );
  });

  test("the runner serves redacted output with the sign-in details intact", async () => {
    const base = mkdtempSync(join(tmpdir(), "headroom-runner-"));
    try {
      const script = join(base, "leaky.ts");
      writeFileSync(
        script,
        `process.stdout.write("https://example.com/device\\ncode ABCD-EFGH\\n{\\"refresh_token\\":\\"synthetic-r\\"}\\n");
await Bun.sleep(5000);`,
      );
      const runner = new CliLoginRunner({ attemptsDir: join(base, "attempts") });
      runner.start({
        attemptId: "attempt-3",
        command: [process.execPath, script],
        homeVariable: "FAKE_HOME",
        credentialFile: "auth.json",
        timeoutMs: 10_000,
      });
      await until(() => (runner.status("attempt-3")?.output ?? "").includes("refresh_token"));
      const output = runner.status("attempt-3")?.output ?? "";
      expect(output).toContain("https://example.com/device");
      expect(output).toContain("ABCD-EFGH");
      expect(output).not.toContain("synthetic-r");
      await runner.cleanup("attempt-3");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
