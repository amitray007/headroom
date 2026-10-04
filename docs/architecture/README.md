# Architecture overview

Headroom is one Bun process. It owns dashboard sign-in, account connections, provider clients, scheduled collection, normalized snapshots and the web interface. Sign-in runs through the pinned official CLI where one works headless, or through a direct OAuth or device-code client where it does not. Refresh and collection are always direct HTTP from inside the process. No CLI runs on the refresh path. See [ADR 0001](../decisions/0001-direct-provider-clients.md) for why.

**Status: proposed design. No application components below are implemented.**

## Components and ownership

| Component | Responsibility | Durable state |
| --- | --- | --- |
| Web interface | Owner sign-in, Connect steps, account selection and usage display | Browser session cookie only; no provider tokens |
| HTTP API | Authorize the owner, manage connections and attempts, expose snapshots | SQLite |
| Connector modules | One per provider: begin login, finish login, refresh, identity, collect, disconnect | None; they read and write through the credential store |
| CLI login runner | Spawn a pinned official CLI headless for one sign-in, bound and redact it, hand its credentials file to the connector | Temporary per-attempt directory, deleted on completion |
| Credential store | Encrypt, persist and serialize access to each connection's tokens or key | `credentials` table; master key file outside the database |
| Scheduler | Per-connection refresh with lease, jitter and backoff | `sync_runs` rows |
| Snapshot store | Normalized observations, capabilities, actions | SQLite tables in [the data model](data-model.md) |

A refresh moves from scheduler to connector to provider endpoint, then stores a snapshot. The web interface reads stored snapshots. A page view never starts a provider request.

## Why CLI for sign-in and HTTP for everything else

The official CLIs own their sign-in flows and already run headless for Codex, Claude and Grok: they print a URL or device code and write a credentials file. Letting them do that one job means Headroom never embeds those providers' OAuth client ids and the sign-in completes in the provider's own flow. Letting them do anything more means a process per account on the refresh path, output parsing, keyring dependencies and restart proofs, and for Claude the official output cannot be passive at all. So the CLI runs once per Connect, and every refresh is a plain HTTP call against the endpoint that CLI would have called, validated by a schema and backed by a synthetic fixture. Antigravity is the exception: its CLI needs a keyring, so Headroom implements its Google sign-in directly with the constants CLIProxyAPI uses.

The cost is that most of those endpoints are private. Each metric carries an `official` or `private` interface label, each private connector sits behind an enable flag, and the deployment is personal and self-hosted only.

## Remote browser approval

The server has no browser and the browser has no access to the server's localhost. Headroom handles that per flow type:

- **CLI login:** the runner starts the official CLI headless; it prints a device code (Codex, Grok) or a URL plus a code prompt (Claude). The browser shows exactly that, the user approves on the provider site and pastes a code back if asked, and the CLI writes its file. Codex, Claude, Grok.
- **Device code:** the server requests a code, the browser shows it, the user approves on the provider site, the server polls. Copilot; fallback for Codex and Grok.
- **Pasted redirect:** the server builds an authorization URL whose redirect points at the provider's registered localhost address. The user approves, lands on a page that does not load, and pastes that URL or the displayed code into Headroom. The server extracts the code and finishes the exchange. Antigravity; fallback for Claude.
- **Approval with polling:** the server opens a provider URL and polls the provider until the approval completes. Cursor.
- **API key:** the user pastes a key once. Vercel, Cursor admin, Grok API.
- **Credential import:** the user pastes an existing CLI or CLIProxyAPI auth file once. Codex, Claude, Grok.

An optional callback bridge that listens on the provider's registered localhost port and forwards into Headroom, as CLIProxyAPI does, can come later for users who SSH-forward ports. It is not required.

## Protocol selection

1. Sign in through the official CLI when it runs headless on Linux without a keyring; otherwise through a direct client with the constants CLIProxyAPI uses.
2. Collect from a documented account API where it covers the need, using the official package when one exists (`@ai-sdk/gateway`).
3. Otherwise collect from the HTTP endpoint the official client calls, with the headers OpenUsage documents, labelled `private`, with versioned fixtures.
4. Never run a CLI on the refresh path. ACP is out of scope; see [the ACP assessment](../research/acp.md).

## Shared contracts

- [Connection lifecycle](connections.md) defines login, validation and reconnect states.
- [Connector contract](connector-contract.md) defines the interface each provider module implements.
- [Data model](data-model.md) defines identity, state enums and metric units.
- [HTTP API](api.md) defines the overview, settings and rename routes.
- [Deployment](deployment.md) defines the binary, storage and key handling.

## Current boundary

The repository has no package manifest, web server, database schema or container image. Documentation commands are in the root Makefile. Runtime pinning, package checks and deployment configuration belong to the milestones in [the roadmap](../roadmap.md).
