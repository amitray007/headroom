# Implementation roadmap

This is the complete plan for building Headroom on the direct-client design in [ADR 0001](decisions/0001-direct-provider-clients.md). Only M0 is complete. Milestones are ordered so that each one ships something the owner can use.

## M0: Project foundation

Status: complete. Product scope, architecture, seven provider dossiers, research, evidence register, decision records and documentation checks exist. No remote repository, code or deployment.

## M1: Core service and Codex

Status: implemented against synthetic fixtures on 2026-10-01; live validation with Amit's account is the remaining step. Better Auth replaced the password-only owner sign-in (D22).

Deliverables:

- Bun workspace with Hono, Drizzle on SQLite and Zod; modules for config, store, crypto, owner auth, CLI login runner, scheduler, API, web and one `connectors/codex` module. The workspace, tooling, CI and canonical enumerations exist from the scaffold in [ADR 0002](decisions/0002-stack-and-tooling.md).
- SQLite schema from [the data model](architecture/data-model.md) with embedded migrations.
- Owner bootstrap on first run, password sign-in, secure session cookie, CSRF protection on mutations.
- Encrypted credential store with key versioning and a per-connection lease.
- Attempt state machine with the `device_code` and `paste_file` next steps.
- CLI login runner: spawn `codex login --device-auth` headless in a per-attempt directory, parse the URL and code, wait for `auth.json`, encrypt it, delete the directory.
- Codex connector: CLI login and credential import, token refresh against the ChatGPT token endpoint, identity from token claims, collection from `wham/usage` and the reset-credit inventory read, capabilities, disconnect.
- Scheduler with interval, jitter, `Retry-After` and backoff.
- JSON API for connections, attempts, snapshots and manual refresh. One server-rendered page that lists connections with their latest metrics and data age. No charts.
- Docker image with the pinned Codex CLI, `bun build --compile` output, and a `make` target set: build, test, lint, run.

Completion criteria:

- Browser approval works from a device other than the server, and the CLI login completes on Linux without a keyring.
- Two Codex accounts connect and refresh concurrently with no credential or snapshot crossover.
- Process restart preserves connections and the next refresh succeeds without re-login.
- A forced token expiry triggers refresh; a forced `invalid_grant` yields `reconnect_required` with `refresh_rejected` and the old snapshot still visible; Reconnect restores the same connection with continuous history.
- Replayed 429 and 5xx responses leave the state unchanged and only record the run; a replayed 403 marks one metric `not_authorized`.
- The only owner controls are Connect, Reconnect and Disconnect; an internal Refresh now control shares the lease and rate limit.
- Expired, denied and cancelled attempts each show a distinct state.
- No secret appears in responses, logs or fixtures. No model request or reset redemption is issued.
- Synthetic fixtures cover success, partial response and schema drift for every Codex endpoint.

## M2: API-key providers

Status: Vercel and Grok implemented against fixtures on 2026-10-01; live validation pending. The Grok management-API balance connection is not started.

- Vercel AI Gateway: key validation, team scope, `getCredits()` and `getSpendReport()` through the pinned `@ai-sdk/gateway` package, spend report where the plan allows it.
- Grok: `grok login --device-auth` through the CLI runner, credential import, refresh at `auth.x.ai`, weekly shared pool and pay-as-you-go cap from `cli-chat-proxy.grok.com/v1/billing`, plan from `/v1/settings`. Team or business logins answer 412 and become `partial`. Management API prepaid balance as a separate `api_key` connection.

Completion: each connector passes the shared checks in [validation](validation.md); a failed spend report never discards a working balance.

## M3: OAuth family

Status: Claude and Antigravity implemented against fixtures on 2026-10-01; Claude is off by default. Live validation pending for both.

- Claude: `claude` login through the CLI runner with its URL and pasted code, credential import of `.credentials.json`, token refresh, collection from `api/oauth/usage` with five-hour, seven-day, model-scoped buckets and reset grants. A `setup-token` cannot read limits, so only a real login counts. Off by default; the owner enables it knowingly. Direct PKCE client as fallback.
- Antigravity: direct Google OAuth with the client constants CLIProxyAPI uses, pasted redirect, project id lookup, collection from `retrieveUserQuotaSummary` with the legacy per-model endpoints as fallback. Credits stay `unknown` until a source exists.

Completion: each connector proves remote approval, refresh, revocation handling and fixtures. Each metric is labelled `private` and the UI shows the label.

## M4: Copilot and Cursor

Status: not started. Dependency: M1 core.

- Copilot: GitHub device flow with a public CLI client id, collection from `copilot_internal/user` with the headers OpenUsage documents: AI-credits percent, extra usage, chat and completions, plan and reset. Org-managed seats return no per-seat percent; owners and billing managers get org totals from the official billing REST API as a separate `organization` capability.
- Cursor member: pi-cursor sign-in and refresh if its auth module runs without the pi runtime, otherwise a port of it; collection from the dashboard RPC with the `cursor.com/api/usage` and `usage-summary` REST fallbacks, both pools and the billing cycle.
- Cursor team admin: admin API key, members, daily usage with pagination and the 30-day range limit, spend. Read-only endpoints only.

Completion: a non-admin and an admin account each validate separately. Pool names are stored as provider data, not mapped to a fixed vocabulary.

## M5: Dashboard and history

Status: not started. Dependency: reliable snapshots from M1 to M4.

Account cards, independent quota buckets, balance and spend views, reset countdowns and reset inventories, stale and partial states, private-interface labels, manual refresh. Historical charts only from stored observations. Choose the UI stack then: a small embedded Vite app or server-rendered templates. Validate desktop, mobile and keyboard use.

## M6: Actions and release readiness

Status: not started. Dependency: read paths and identity checks proven per provider.

Codex reset redemption with an action row, idempotency key, confirmation naming the credit, outcome reconciliation and a follow-up snapshot. No generic retry after an uncertain mutation. Disconnect with provider revocation where documented. Retention, backup and restore verification. Optional callback bridge on provider localhost ports for the direct-client fallbacks.

Before any public release: dependency licenses, CLI redistribution terms, attribution for any ported CLIProxyAPI or OpenUsage logic, private-interface labels, deployment instructions, security reporting channel. Creating a remote, committing, pushing, publishing and deploying remain separate actions.

## Working agreements

- Every connector lives in one module with one endpoints file, one Zod schema file, one fixture directory and one validation record.
- A CLI runs for sign-in only, once per Connect, and never on the refresh path.
- A metric reaches the UI only with an interface label and an evidence level of `validated`.
- No connector calls an endpoint its dossier does not list.
- Policy posture is personal self-hosted use. Headroom is never offered as a hosted service on this design.
