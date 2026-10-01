import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { username } from "better-auth/plugins";
import { count } from "drizzle-orm";

import { type Db, schema } from "../db/index.ts";

/**
 * Better Auth for the single owner: username plus password, and passkeys.
 * See docs/decisions/0002-stack-and-tooling.md (D22) and docs/architecture/deployment.md.
 */

export const minimumPasswordLength = 12;
export const minimumUsernameLength = 3;

export interface AuthOptions {
  readonly db: Db;
  /** Signing secret for sessions and tokens; from the auth secret file. */
  readonly secret: string;
  /** Public origin Headroom is served from, no trailing slash. Also the passkey relying party origin. */
  readonly baseUrl: string;
  /** Origins allowed to call the auth API and embed the UI. Always includes baseUrl. */
  readonly trustedOrigins: readonly string[];
  /** Rate limiting is on by default; tests turn it off because its memory store is process-wide. */
  readonly rateLimit?: boolean;
  /** Receives Better Auth's own warnings and errors. Silent when omitted. */
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

export function createAuth(options: AuthOptions) {
  const base = new URL(options.baseUrl);
  const origins = [...new Set([base.origin, ...options.trustedOrigins])];
  return betterAuth({
    appName: "Headroom",
    logger: {
      level: "warn",
      log: (level, message) => options.log?.(level, `better-auth: ${message}`),
    },
    baseURL: base.origin,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: origins,
    database: drizzleAdapter(options.db, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: minimumPasswordLength,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    plugins: [
      username({ minUsernameLength: minimumUsernameLength }),
      passkey({
        rpID: base.hostname,
        rpName: "Headroom",
        origin: base.origin,
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      }),
    ],
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: options.rateLimit ?? true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-in/username": { window: 60, max: 5 },
        "/sign-in/passkey": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 3 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "headroom",
      useSecureCookies: base.protocol === "https:",
      database: { generateId: () => Bun.randomUUIDv7() },
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (ownerExists(options.db)) {
              throw new APIError("FORBIDDEN", {
                message: "Headroom has one owner; sign-up is closed",
              });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionInfo = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

/** True once the single owner has signed up. */
export function ownerExists(db: Db): boolean {
  const row = db.select({ n: count() }).from(schema.user).get();
  return (row?.n ?? 0) > 0;
}
