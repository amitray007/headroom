/**
 * Used only by `bun run auth:generate` to emit the Better Auth Drizzle schema.
 * The CLI only reads plugins and options, so the database handle is a placeholder.
 * The runtime configuration lives in src/auth/index.ts.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";

const placeholderDb = {} as unknown as Parameters<typeof drizzleAdapter>[0];

export const auth = betterAuth({
  database: drizzleAdapter(placeholderDb, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  plugins: [username(), passkey()],
});
