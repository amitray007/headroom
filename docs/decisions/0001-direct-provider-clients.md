# ADR 0001: Direct provider clients in one TypeScript service

Status: accepted. Proposed on 2026-10-01, revised the same day after the maintainer's review, and implemented. Supersedes the official-CLI worker design in D08 and the TypeScript and Go stack proposals in D09.

## Context

The first draft of Headroom spawned each provider's official CLI as a long-lived server-side worker and read quota data from its supported outputs. Re-checking the sources on 2026-10-01 showed that this route does not deliver the product:

- Claude Code's status line carries `rate_limits` only after the first model response in a session, so passive collection through the official binary is impossible without a billable prompt.
- Antigravity's status line is also an interactive-session artifact, and its credential store depends on an OS keyring that a headless Linux container does not have.
- Every CLI needs its own home-directory isolation, output parsing, version pinning and restart proof on the refresh path. That is a large operational surface for a dashboard that only reads numbers.

Two reference projects show the alternative. [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (Go, MIT) implements each provider's sign-in itself, stores one JSON credential per account, refreshes in-process and drives remote logins from a management API. [OpenUsage](https://github.com/robinebers/openusage) (Swift, MIT) reads the credential files the official CLIs leave behind and calls the HTTP usage endpoints those CLIs call, which makes it the most precise endpoint reference available. The owner asked for Headroom to work the way CLIProxyAPI does, to take the usage routes from OpenUsage, and to reuse TypeScript packages where they exist.

## Decision

1. **Sign-in through the official CLI where one exists, run only for login.** For Claude, Codex and Grok, a Connect spawns the pinned official CLI headless with a per-connection config directory, captures the URL or device code it prints, shows it behind the Connect button, feeds back the pasted code where the flow needs one, and waits for the CLI to write its credentials file. Headroom then reads that file once, encrypts it, deletes the directory and never runs the CLI again for that connection. The provider's own flow completes the sign-in. Token refresh still needs the provider's token endpoint and the public client id the CLI uses, so those two constants are embedded per connector; they are public identifiers shipped in every CLI and in CLIProxyAPI and OpenUsage source.
2. **Direct OAuth client where the CLI cannot run headless.** Antigravity's `agy` stores tokens in the Linux Secret Service keyring, so Headroom implements its Google OAuth sign-in directly with the client constants CLIProxyAPI uses and the pasted-redirect step. The same direct client is the documented fallback for Claude, Codex and Grok if their CLI login fails validation.
3. **Device flow and packages elsewhere.** Copilot uses the GitHub device flow with a public CLI client id. Cursor members use the pi-cursor sign-in and refresh; Cursor admins and Vercel use pasted keys. Vercel collection uses the official `@ai-sdk/gateway` package.
4. **Collection is always direct HTTP.** Every refresh calls the endpoint the official client calls, with the headers OpenUsage documents: `wham/usage` for Codex, `api/oauth/usage` for Claude, `cli-chat-proxy.grok.com/v1/billing` for Grok, `retrieveUserQuotaSummary` for Antigravity, `copilot_internal/user` plus the official org billing API for Copilot, Cursor's dashboard and usage-summary routes, and `/v1/credits` for Vercel. Each metric is labelled `official` or `private`.
5. **Credential import.** A user who already has a laptop login can paste that CLI's auth file (Codex `auth.json`, Claude `.credentials.json`, Grok `auth.json`, or a CLIProxyAPI auth file) into Headroom once. It is validated, re-encrypted and treated like any other connection.
6. **TypeScript on Bun, single binary, SQLite.** Hono for HTTP, Drizzle on SQLite, Zod at every provider boundary, `bun build --compile` for one binary, Docker as the deployment unit. The UI in M5 shares types with the backend. Credentials are encrypted at rest with a key file outside the database.
7. **Single owner first.** One dashboard owner, strict per-connection isolation, no multi-user tenancy.
8. **Codex is the first connector.** Its CLI device login, credentials file and usage probe are the best understood of the set, and it is the account the maintainer uses most.

## Rejected

- **Long-lived CLI workers for collection.** See context.
- **Go.** CLIProxyAPI's importable SDK is interactive and its reusable part is a few hundred lines of constants per provider; TypeScript gains `@ai-sdk/gateway`, pi-cursor and pi-ai directly and shares types with the UI.
- **A virtual shell such as just-bash as the CLI runner.** It is an in-memory bash for agents and cannot execute a native binary. The CLI runner is `Bun.spawn` or a pseudo-terminal with explicit environment allowlisting.
- **Laptop-side collectors.** Reading the user's local credential files from a helper is OpenUsage's model, not a self-hosted dashboard's. Import replaces it.

## Policy posture

These are private interfaces. The provider documents say:

- OpenAI: app-server authentication "has never been permitted for commercial or hosted services". Reusing the CLI's credentials file and `wham/usage` is the same category.
- Anthropic: third parties "may not collect, store, or intermediate Claude.ai credentials or session tokens"; sign-in must complete through Anthropic's own flow. Headroom signs in through the official CLI, so sign-in completes in Anthropic's own flow. It then stores the owner's own token on the owner's server to read usage. Read Anthropic's terms before enabling Claude.
- GitHub, Google, xAI and Cursor publish no terms for their internal usage endpoints.

Headroom is a personal self-hosted tool. The only credentials it stores belong to the person running it, and the only risk is to that person's own accounts. Headroom does not proxy inference, resell access or host other people's accounts, and must not be offered as a hosted service on this design. Every private-interface connector is labelled in the UI, ships behind a per-provider enable flag, and the owner can turn any provider off. Claude carries the highest policy risk, so read Anthropic's terms before using it. If a provider changes an endpoint or revokes a token, the connection shows `reconnect_required` and nothing else breaks.

## Consequences

- The image bundles pinned `claude`, `codex` and `grok` CLIs for login only. Each needs a Linux headless proof: the login completes without a keyring and writes a known file.
- The connection lifecycle gains a `cli_login` method whose next steps are the same `device_code` and `paste_redirect` the direct clients use; the browser cannot tell the routes apart.
- The owner has three actions only: Connect, Reconnect, Disconnect. Refresh is automatic with a documented failure classification; only definitive failures ask for Reconnect.
- Dossiers for Claude, Codex and Grok carry the CLI route first, the direct client second. Antigravity carries the direct client first, the `agy` CLI second. Grok and Copilot take their endpoints and field vocabulary from OpenUsage.
- Validation adds a CLI-login row and drops nothing else from the revised plan.
- The roadmap stays Codex first, then Vercel and Grok, then Claude and Antigravity, then Copilot and Cursor.
