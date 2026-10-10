# Deployment and credential storage

The target is one Bun-compiled binary, one SQLite file, one key file and three login-only CLIs on a Linux host, run directly or in a container. This document defines the requirements the shipped image and binary meet. The runnable steps are in [Self-hosting on a tailnet](../operations/tailscale.md) and [Install](../operations/install.md).

## Shape

- One process serves the web interface, the API, the scheduler and every connector.
- The image installs the official CLIs for sign-in only: `@openai/codex` and `@anthropic-ai/claude-code` from npm, and `grok`, a static binary the `Dockerfile` downloads directly from `https://x.ai/cli/` for the build architecture and checks against a SHA-256 per architecture (the vendor installer checks nothing; the server publishes no checksum file). Each image build takes the current releases, Codex's latest, Claude Code's `stable` channel and Grok's stable release, and records them as the image labels `club.theblank.headroom.codex-version`, `claude-code-version` and `grok-version` (D37). The smoke test starts and cancels a sign-in with each CLI before the image gets a public tag. A local `docker build` uses the `Dockerfile` defaults, the versions last validated by hand. The image has no browser and no `open`; the runner's shims make that explicit on every host. Codex and Grok are Apache-2.0. Claude Code is proprietary: the image installs it unmodified from npm, and each owner signs in with their own Claude account, the two conditions [Anthropic's legal page](https://code.claude.com/docs/en/legal-and-compliance) sets for preinstalled Claude Code. [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) gives each CLI's license or terms; the image ships it with `LICENSE` and `LICENSES/` in `/usr/share/doc/headroom`. No CLI runs on the refresh path. The `Dockerfile` runs as an unprivileged user with the data directory and secret files on two volumes.
- Without path variables the binary uses per-user directories: on macOS `~/Library/Application Support/Headroom/` (`data/`, `headroom.key`, `headroom.auth-secret`), on Linux `${XDG_DATA_HOME:-~/.local/share}/headroom/data` for data and `${XDG_CONFIG_HOME:-~/.config}/headroom/` for the key and secret, so the key stays outside the data directory. `mise.toml` sets `.data` and `.state` for development; the image sets `/var/lib/headroom` and `/etc/headroom`. `headroom paths` prints the resolved values.
- `HEADROOM_HOST` is the listen address, default `127.0.0.1`; the image sets `0.0.0.0`. `HEADROOM_CODEX_BIN`, `HEADROOM_CLAUDE_BIN` and `HEADROOM_GROK_BIN` give absolute paths of the sign-in CLIs when they are not on `PATH`.
- `headroom service install` registers a per-user login service: a launchd agent (`club.theblank.headroom`) on macOS, a systemd user unit on Linux. It records the installing shell's `PATH` so the service can find the sign-in CLIs.
- `HEADROOM_DATA_DIR` holds `headroom.db` in WAL mode and nothing else that must be backed up.
- `HEADROOM_MASTER_KEY_FILE` points at a 32-byte hex key outside the data directory. Losing it loses every connection, and the user reconnects. Document that plainly.
- `HEADROOM_AUTH_SECRET_FILE` holds the session signing secret, created on first run with mode 0600. Rotating it signs the owner out.
- `HEADROOM_PUBLIC_URL` is the public origin. It fixes the passkey relying party, Secure cookies and HSTS. `HEADROOM_TRUSTED_ORIGINS` adds origins allowed to call the API and embed the UI.
- `HEADROOM_TRUST_PROXY=true` makes Headroom take the client address from the last entry of `X-Forwarded-For`, the one the proxy appended, for sign-in throttling. Leave it off unless a reverse proxy you control sets that header; otherwise the socket address is used and any client-supplied header is discarded.
- `HEADROOM_ENABLED_PROVIDERS` lists the connectors that exist at runtime, default all seven. `HEADROOM_REFRESH_INTERVAL_SECONDS` sets the default of the owner's refresh-interval setting (the nearest of 5, 10, 15 or 30 minutes), which then wins. `HEADROOM_STALE_AFTER_SECONDS` tunes the stale notice.
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

The supported self-hosting setup is a private tailnet: [Self-hosting on a tailnet](../operations/tailscale.md). No public hosting, domain or tunnel is provided.
