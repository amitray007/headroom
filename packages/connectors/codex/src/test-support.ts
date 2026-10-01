import type { CliLoginStatus, LoginRunner } from "@headroom/core";

import type { FetchLike } from "./index.ts";

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Build an unsigned JWT with the given payload. Signature is irrelevant; Headroom only decodes claims. */
function unsignedJwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.sig`;
}

export const accountId = "acct_synthetic_123";

export function idToken(overrides: Record<string, unknown> = {}): string {
  return unsignedJwt({
    exp: 1_700_003_600,
    email: "owner@example.com",
    "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_plan_type: "pro" },
    ...overrides,
  });
}

export function accessToken(exp = 1_700_003_600): string {
  return unsignedJwt({ exp, sub: "user" });
}

export function authFile(): string {
  return JSON.stringify({
    tokens: {
      id_token: idToken(),
      access_token: accessToken(),
      refresh_token: "refresh-synthetic",
      account_id: accountId,
    },
    last_refresh: "2026-10-01T00:00:00Z",
  });
}

/** Scripted stand-in for the real runner: no processes, just statuses and a credentials body. */
export class FakeRunner implements LoginRunner {
  readonly started: string[] = [];
  readonly cleaned: string[] = [];
  output = "";
  state: CliLoginStatus["state"] = "running";
  credentials: string | null = null;

  start(spec: { attemptId: string }): void {
    this.started.push(spec.attemptId);
  }
  status(): CliLoginStatus {
    return {
      state: this.state,
      exitCode: null,
      output: this.output,
      credentialsPresent: this.credentials !== null,
    };
  }
  readCredentials(): string | null {
    return this.credentials;
  }
  cleanup(attemptId: string): Promise<void> {
    this.cleaned.push(attemptId);
    return Promise.resolve();
  }
  kill(): Promise<void> {
    return Promise.resolve();
  }
  write(): void {
    // The fake never needs stdin.
  }
}

export interface FakeFetch {
  readonly fetch: FetchLike;
  readonly calls: string[];
}

/** A fetch stub keyed by URL prefix. */
export function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): FakeFetch {
  const calls: string[] = [];
  const impl: FetchLike = (url) => {
    calls.push(url);
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!match) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(routes[match]!());
  };
  return { fetch: impl, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
