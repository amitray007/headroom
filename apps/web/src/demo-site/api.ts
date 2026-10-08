import { providers, settingsSchema, type Currency, type Settings } from "@headroom/core/contracts";

import { defaultSettings } from "../lib/settings-store.ts";

/** The in-browser stand-in for the Headroom server in the demo site. Nothing here touches the network. */

const demoOwner = {
  id: "demo-owner",
  name: "Demo Owner",
  email: "owner@example.com",
  username: "demo",
};

/** Fixed synthetic rates, units per 1 USD. They are not market data. */
const perUsd: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.2,
  CAD: 1.36,
  AUD: 1.52,
  JPY: 149.5,
  SGD: 1.34,
  CHF: 0.88,
  BRL: 5,
};

const providerMethods = {
  codex: { interface: "private", methods: ["cli_login", "paste_redirect"] },
  claude: { interface: "private", methods: ["paste_redirect"] },
  grok: { interface: "private", methods: ["import"] },
  antigravity: { interface: "private", methods: ["paste_redirect"] },
  copilot: { interface: "official", methods: ["device_code"] },
  cursor: { interface: "private", methods: ["import"] },
  vercel_ai_gateway: { interface: "official", methods: ["api_key"] },
} as const;

let settings: Settings = defaultSettings;

/** Put the session state back to the defaults. Tests use it; the page never needs to. */
export function resetDemoApi(): void {
  settings = defaultSettings;
}

const refusal = (): Response => Response.json({ error: "demo_mode" }, { status: 409 });
const notFound = (): Response => Response.json({ error: "not_found" }, { status: 404 });

function rates(): Response {
  return Response.json({
    base: "USD",
    date: "2026-01-02",
    fetchedAt: Date.now(),
    perUsd,
    error: null,
  });
}

function session(): Response {
  const now = new Date().toISOString();
  return Response.json({
    session: {
      id: "demo-session",
      userId: demoOwner.id,
      token: "demo-session-token",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: now,
      updatedAt: now,
    },
    user: {
      ...demoOwner,
      displayUsername: demoOwner.username,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  });
}

function auth(method: string, path: string): Response {
  if (method === "GET" && path === "/api/auth/get-session") return session();
  if (method === "GET" && path === "/api/auth/passkey/list-user-passkeys") return Response.json([]);
  if (method === "POST" && path === "/api/auth/sign-out") return Response.json({ success: true });
  if (method === "GET") return Response.json(null);
  return refusal();
}

function getRoute(path: string): Response {
  switch (path) {
    case "/api/setup":
      return Response.json({
        ownerExists: true,
        minimumPasswordLength: 12,
        minimumUsernameLength: 3,
      });
    case "/api/me":
      return Response.json({ id: demoOwner.id, name: demoOwner.name, email: demoOwner.email });
    case "/api/providers":
      return Response.json({
        providers: providers.map((provider) => ({
          provider,
          version: "demo",
          ...providerMethods[provider],
        })),
      });
    case "/api/connections":
      return Response.json({ connections: [] });
    case "/api/overview":
      return Response.json({
        connections: [],
        providerOrder: providers,
        refreshIntervalMs: 900_000,
        staleAfterMs: 3_600_000,
      });
    case "/api/settings":
      return Response.json({ settings });
    case "/api/exchange-rates":
      return rates();
    case "/api/wallet":
      return Response.json({ costs: {}, topUps: [] });
    case "/api/delivery/channels":
      return Response.json({ channels: [] });
    default:
      return notFound();
  }
}

/**
 * Answer one `/api/` request in memory. Reads return synthetic values, settings are kept for the session, and
 * every other change gets the same `demo_mode` refusal the server sends while Demo Mode is on.
 */
export function handleDemoRequest(method: string, url: string, body: unknown): Response {
  const path = new URL(url, "http://demo.invalid").pathname;
  const verb = method.toUpperCase();
  if (path.startsWith("/api/auth/")) return auth(verb, path);
  if (verb === "GET" || verb === "HEAD") return getRoute(path);
  if (verb === "PUT" && path === "/api/settings") {
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "invalid_settings" }, { status: 400 });
    settings = parsed.data;
    return Response.json({ settings });
  }
  if (verb === "POST" && path === "/api/exchange-rates/refresh") return rates();
  return refusal();
}
