# ADR 0002: Stack and tooling baseline

Status: applied on 2026-10-01 as the project scaffold. Implements the stack choice in [ADR 0001](0001-direct-provider-clients.md).

## Decision

| Concern | Choice | Pinned | Why |
| --- | --- | --- | --- |
| Runtime, package manager, bundler, test runner | Bun | 1.4.2 via `mise.toml` | Native pseudo-terminal in `Bun.spawn` for the CLI login runner; `bun build --compile` for one binary; one tool for install, test and build |
| Tool versions | mise with `mise.lock` | mise 2026.9.11 in CI | One authoritative version per tool; `mise run <task>` is the only entry point locally and in CI |
| HTTP | Hono | 4.13.12 | Small, typed, Bun-native; typed client for the web frontend |
| Validation | Zod | 4.6.5 | Every provider response, pasted file, config and API input passes a schema |
| Database | SQLite via `bun:sqlite`, Drizzle | Drizzle added in M1 | Embedded, WAL, schema in TypeScript where the enumerations live |
| Lint | Oxlint, type-aware | 1.86.0 plus `oxlint-tsgolint` 7.0.2003 | `correctness`, `suspicious` and `perf` as errors, warnings denied, unused disables reported; strict TypeScript rules including floating promises and exhaustive switches |
| Format | Oxfmt | 0.71.0 | Code and JSON only; Markdown stays with the docs checker so dossier tables are not rewritten |
| Dead code | Knip | 6.39.0 | Per-workspace entry and project patterns; no ignores |
| Types | TypeScript | 7.0.2 | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; `tsc --noEmit` is the type gate |
| CI | GitHub Actions, one job | Actions pinned by SHA | mise-action installs tools, Bun cache keyed on `bun.lock`, then `mise run check`, `bun audit --audit-level=high`, `mise run build` and a binary smoke run |
| Dependency updates | Dependabot | Weekly | Bun and GitHub Actions ecosystems; Oxc packages grouped |

## Commands

`mise run check` is the one command that must pass before a commit. It runs the docs check, `oxfmt --check`, `oxlint --type-aware --deny-warnings`, `tsc --noEmit`, `knip` and `bun test`, in that order. `make check` calls the same thing for anyone who reaches for Make. `mise run build` produces `dist/headroom`; `mise run dev` runs the server with reload.

## Layout

```
apps/server/      Hono app, scheduler, CLI runner, API; the compiled entry point
packages/core/    canonical enumerations, Zod schemas, crypto, lifecycle rules
packages/connectors/<provider>/   endpoints.ts, schemas.ts, fixtures/, index.ts
packages/view-model/   shared view types and the Demo Mode data
apps/web/         Vite and React, embedded into the binary
```

Workspace packages export TypeScript source directly; Bun runs it without a build step and `tsc` type-checks everything from the root.

## Authentication (D22, added 2026-10-01)

The maintainer chose Better Auth over the hand-written owner store so the dashboard gets username, password and passkey sign-in from a maintained library. Decisions taken with it:

- `better-auth` 1.7.7 with the `username` plugin and `@better-auth/passkey`, on the Drizzle SQLite adapter. Its tables (`user`, `session`, `account`, `verification`, `passkey`) are generated into `packages/core/src/db/auth-schema.ts` by `bun run auth:generate` and migrated with the rest of the schema.
- Single owner: a `user.create.before` hook refuses a second sign-up with 403. `/api/setup` tells the UI whether the owner exists.
- Passkeys use the public URL's host as relying-party id and the public origin as WebAuthn origin, so passkeys only work on the configured domain.
- Rate limits are on in every environment: five sign-ins per minute per address, three sign-ups, ten passkey sign-ins. The store is in-memory, which is correct for one process.
- Sessions last thirty days, refresh daily, and are cached in a signed cookie for five minutes. Cookies are prefixed `headroom`, HttpOnly, Lax, and Secure under an https public URL.
- The session signing secret lives in its own 0600 file next to the master key, created on first run. Rotating it signs the owner out and nothing else.
- Trusted origins come from `HEADROOM_TRUSTED_ORIGINS` plus the public URL and feed three places at once: Better Auth's origin check, the CORS allowlist with credentials, and the CSP `frame-ancestors` list. `X-Frame-Options` is off because `frame-ancestors` supersedes it.
- Headroom's own mutating routes are additionally guarded by `Sec-Fetch-Site` and `Origin` checks against the same list.

## Rules the tooling enforces

- No `any`, no unhandled promise, no non-exhaustive switch, no default export outside the server entry, no `console` in library code.
- No invented enumeration: `packages/core/src/enums.ts` is the single source and the docs checker rejects stale names in dossiers.
- Formatting is never discussed in review; `oxfmt` decides.
- A dependency is pinned to an exact version and arrives through Dependabot or an explicit decision.

## Rejected

- Biome, ESLint and Prettier: Oxlint and Oxfmt cover the same ground faster and are already the maintainer's direction.
- Vitest: `bun test` is built in and sufficient.
- Lefthook or other Git hooks: CI is the gate; hooks can be added if review shows unformatted commits.
