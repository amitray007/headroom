# Headroom documentation

This is the documentation entry point for contributors. Headroom is a working application; these documents are its specification and research. Research was consolidated on **2026-10-01**. Product behavior and architecture below are specifications unless a document explicitly labels prior runtime evidence, and a connector counts as supported only with the evidence the validation plan requires.

## Read in this order

1. [Product scope](product.md): what the dashboard must do.
2. [ADR 0001](decisions/0001-direct-provider-clients.md): the direct-client design, its policy posture and why the CLI-worker draft was dropped.
3. [Provider matrix](providers/README.md): which integrations are candidates and what blocks them.
4. [Architecture overview](architecture/README.md): ownership and the single-binary shape.
5. [Connection lifecycle](architecture/connections.md): the browser Connect flow, attempt and connection states.
6. [Data model](architecture/data-model.md): identities, enumerations, metrics, credentials, history and the Wallet.
7. [Validation plan](validation.md): evidence required before calling a connector supported.
8. [Roadmap](roadmap.md): the complete milestone plan with completion criteria.

## Provider dossiers

Each dossier describes metrics, connection steps, tools, limitations and sources. Every candidate provider has a dossier and a TypeScript connector in `packages/connectors/`. A connector's presence does not prove its metrics: the dossier and the validation plan record what is validated.

| Provider | Document |
| --- | --- |
| Claude Max / Pro subscriptions | [Claude](providers/claude.md) |
| Codex Pro, Business and Go accounts | [Codex](providers/codex.md) |
| Cursor personal and Teams | [Cursor](providers/cursor.md) |
| GitHub Copilot | [Copilot](providers/copilot.md) |
| Vercel AI Gateway | [Vercel AI Gateway](providers/vercel-ai-gateway.md) |
| Grok / Grok Build | [Grok](providers/grok.md) |
| Antigravity | [Antigravity](providers/antigravity.md) |

## Shared references

- [HTTP API](architecture/api.md): overview, display name, settings, the Wallet, and the account-actions gate.
- [Notifications](architecture/notifications.md): what raises a notification, the event schema, and server-side delivery to Telegram and webhooks.
- [Connector contract](architecture/connector-contract.md): the TypeScript interface every provider package implements, in `packages/core/src/connector.ts`.
- [Deployment and credential storage](architecture/deployment.md): single binary, SQLite, master key and backups.
- [Self-hosting on a tailnet](operations/tailscale.md): Docker Compose or Dokploy with a private Tailscale address, the environment, moving data, backups.
- [Evidence register](research/evidence.md): proof levels and earlier observations.
- [Tools and packages](research/tools.md): what can be reused and what it does not solve.
- [ACP assessment](research/acp.md): protocol scope and provider-specific gaps.
- [Decisions](decisions/README.md): accepted product constraints and proposed implementation choices, with [ADR 0001](decisions/0001-direct-provider-clients.md) as the governing design record, [ADR 0002](decisions/0002-stack-and-tooling.md) for the stack and tooling, and [ADR 0003](decisions/0003-owner-automations.md) for owner automations and detected account events.
- [Glossary](glossary.md): terms and units used across all dossiers.
- [To-do](todo.md): provider data Headroom does not collect yet, and what each item needs before it can ship.
- [Launch](launch.md): the public release plan: versioning, the Docker image, Sponsors, the demo site, the launch video and the launch posts.

## Maintaining these docs

Provider dossiers own endpoint and field details. Shared architecture docs own application behavior. The roadmap owns implementation status. Update those owners first and keep summary tables short.

Cite source claims near the relevant text. Record account observations without personal identifiers or credentials. Do not replace an unknown with an inferred allowance. Run `mise run check` from the repository root after changes.
