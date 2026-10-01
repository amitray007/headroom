# ADR 0002: Stack and tooling baseline

Status: applied on 2026-10-01 as the project scaffold. Implements the stack choice in [ADR 0001](0001-direct-provider-clients.md).

## Decision

| Concern | Choice | Pinned | Why |
| --- | --- | --- | --- |
| Runtime, package manager, bundler, test runner | Bun | 1.4.2 via `mise.toml` | Native pseudo-terminal in `Bun.spawn` for the CLI login runner; `bun build --compile` for one binary; one tool for install, test and build |
| Tool versions | mise with `mise.lock` | mise 2026.9.11 in CI | One authoritative version per tool; `mise run <task>` is the only entry point locally and in CI |
| HTTP | Hono | 4.13.12 | Small, typed, Bun-native; typed client for the M5 frontend |
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
packages/connectors/<provider>/   endpoints.ts, schemas.ts, fixtures/, index.ts (from M1)
apps/web/         M5 only; Vite and React, embedded into the binary
```

Workspace packages export TypeScript source directly; Bun runs it without a build step and `tsc` type-checks everything from the root.

## Rules the tooling enforces

- No `any`, no unhandled promise, no non-exhaustive switch, no default export outside the server entry, no `console` in library code.
- No invented enumeration: `packages/core/src/enums.ts` is the single source and the docs checker rejects stale names in dossiers.
- Formatting is never discussed in review; `oxfmt` decides.
- A dependency is pinned to an exact version and arrives through Dependabot or an explicit decision.

## Rejected

- Biome, ESLint and Prettier: Oxlint and Oxfmt cover the same ground faster and are already Amit's direction.
- Vitest: `bun test` is built in and sufficient.
- Better Auth: a single owner with a password needs `Bun.password` and a signed cookie, not an auth framework.
- Lefthook or other Git hooks: CI is the gate; hooks can be added if review shows unformatted commits.
