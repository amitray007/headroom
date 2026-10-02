# Deployment and credential storage

The target is one Bun-compiled binary, one SQLite file, one key file and three pinned login-only CLIs on a Linux host, run directly or in a container. This document defines requirements, not a runnable guide.

## Shape

- One process serves the web interface, the API, the scheduler and every connector.
- The image installs pinned CLIs for sign-in only: `@openai/codex` 0.159.3 and `@anthropic-ai/claude-code` 2.1.286 from npm, and `grok` from the vendor installer. The image has no browser and no `open`; the runner's shims make that explicit on every host. Check each binary's redistribution terms; where they forbid bundling, install at container build time from the vendor's channel and record the version. No CLI runs on the refresh path. The `Dockerfile` runs as an unprivileged user with the data directory and secret files on two volumes.
- `HEADROOM_DATA_DIR` holds `headroom.db` in WAL mode and nothing else that must be backed up.
- `HEADROOM_MASTER_KEY_FILE` points at a 32-byte hex key outside the data directory. Losing it loses every connection, and the user reconnects. Document that plainly.
- `HEADROOM_AUTH_SECRET_FILE` holds the session signing secret, created on first run with mode 0600. Rotating it signs the owner out.
- `HEADROOM_PUBLIC_URL` is the public origin. It fixes the passkey relying party, Secure cookies and HSTS. `HEADROOM_TRUSTED_ORIGINS` adds origins allowed to call the API and embed the UI.
- `HEADROOM_TRUST_PROXY=true` makes Headroom take the client address from `X-Forwarded-For` for sign-in throttling. Leave it off unless a reverse proxy you control sets that header; otherwise the socket address is used and any client-supplied header is discarded.
- `HEADROOM_ENABLED_PROVIDERS` lists the connectors that exist at runtime, default `codex`. `HEADROOM_REFRESH_INTERVAL_SECONDS` sets the default of the owner's refresh-interval setting (the nearest of 5, 10, 15 or 30 minutes), which then wins. `HEADROOM_STALE_AFTER_SECONDS` tunes the stale notice.
- No environment variable controls account actions. They are off by default and run only after the owner switches on "Allow Account Actions" in Settings and confirms each action; until then the route answers 403 and the button is disabled.
- TLS terminates at a reverse proxy. Headroom listens on one HTTP port and sets secure cookies when it sees a trusted forwarded scheme.
- A long-running process is required. Serverless request lifetimes cannot own a device-code poll or a token refresh.

Dashboard authentication is Better Auth with username, password and passkeys for one owner, rate-limited per address. Provider authentication is separate. Signing in to Headroom grants nothing at any provider.

## Isolation

The first release has one owner, so tenancy isolation is not a requirement. Per-connection isolation still is: every connection has its own credential row, lease and refresh state, and a connector call receives only that connection's credentials. Never pass host environment tokens such as `GH_TOKEN` or `XAI_API_KEY` into a connector; the process allowlists its environment at start.

A CLI login attempt runs in a temporary directory under the data directory with `HOME` and the CLI's config variable pointing inside it, an allowlisted environment, a runtime bound and an output bound. The directory is deleted when the attempt ends in any state.

If multi-user is ever added, that is a new design with an enforced boundary, not a `user_id` column.

## Secrets

API keys and OAuth tokens travel from the browser over TLS once, are encrypted with AES-256-GCM under the master key and a key version, and are stored in `credentials`. The frontend never receives a stored secret. Connector-private attempt state (PKCE verifiers, device auth ids) is encrypted the same way and deleted with the attempt.

Rotating the master key re-encrypts every row under a new key version in one transaction. Backups contain ciphertext only and are useless without the key file; keep the key file out of the database backup and version control.

Import of a CLI or CLIProxyAPI auth file reads the pasted plaintext once in memory, re-encrypts it and never writes it to disk unencrypted. The credentials file a CLI login writes is read once, encrypted and deleted with its directory.

## Process lifecycle

Attempts expire and are cancelled cleanly. Every provider request has a timeout. Per-provider concurrency is bounded. A per-connection lease guards refresh, collection and actions. On shutdown, in-flight refreshes finish writing credentials before the process exits, and an interrupted run is recorded as interrupted.

## Operations

Back up the database file with the SQLite backup API or a WAL-safe copy. Restore to a test instance and verify restart recovery, stale-data presentation and that no action fires on restore.

Logs contain connection ids, endpoint names, status codes and sanitized error classes. They never contain response bodies, tokens, URLs with codes or emails. Metrics track refresh outcomes and durations without identities.

No hosting platform, domain, public tunnel, TLS configuration or production environment has been provisioned.
