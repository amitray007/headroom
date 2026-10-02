# Headroom documentation

This is the documentation entry point for contributors building the first application. Research was consolidated on **2026-10-01**. Product behavior and architecture below are specifications unless a document explicitly labels prior runtime evidence.

## Read in this order

1. [Product scope](product.md): what the dashboard must do.
2. [ADR 0001](decisions/0001-direct-provider-clients.md): the direct-client design, its policy posture and why the CLI-worker draft was dropped.
3. [Provider matrix](providers/README.md): which integrations are candidates and what blocks them.
4. [Architecture overview](architecture/README.md): ownership and the single-binary shape.
5. [Connection lifecycle](architecture/connections.md): the browser Connect flow, attempt and connection states.
6. [Data model](architecture/data-model.md): identities, enumerations, metrics, credentials and history.
7. [Validation plan](validation.md): evidence required before calling a connector supported.
8. [Roadmap](roadmap.md): the complete milestone plan with completion criteria.

## Provider dossiers

Each dossier describes metrics, connection steps, tools, limitations and sources. Every candidate provider has a dossier. None has an implemented connector.

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

- [HTTP API](architecture/api.md): overview, display name, settings, and the account-actions gate.
- [Notifications](architecture/notifications.md): what raises a notification, the event schema, and planned delivery.
- [Connector contract](architecture/connector-contract.md): the Go interface every provider package implements.
- [Deployment and credential storage](architecture/deployment.md): single binary, SQLite, master key and backups.
- [Evidence register](research/evidence.md): proof levels and earlier observations.
- [Tools and packages](research/tools.md): what can be reused and what it does not solve.
- [ACP assessment](research/acp.md): protocol scope and provider-specific gaps.
- [Decisions](decisions/README.md): accepted product constraints and proposed implementation choices, with [ADR 0001](decisions/0001-direct-provider-clients.md) as the governing design record and [ADR 0002](decisions/0002-stack-and-tooling.md) for the stack and tooling.
- [Glossary](glossary.md): terms and units used across all dossiers.

## Maintaining these docs

Provider dossiers own endpoint and field details. Shared architecture docs own application behavior. The roadmap owns implementation status. Update those owners first and keep summary tables short.

Cite source claims near the relevant text. Record account observations without personal identifiers or credentials. Do not replace an unknown with an inferred allowance. Run `make check` from the repository root after changes.
