# Headroom

A self-hosted web dashboard for AI subscription allowances, credit balances and usage.

**Status: project foundation and research.** There is no running dashboard or implemented connector yet. The repository records the product requirements, provider findings and implementation plan. The project name is Headroom. Domain and trademark availability have not been checked.

## Product direction

Connect an account in the browser, approve the provider's sign-in or enter an API key, then see the metrics that account exposes. The server runs the provider's official CLI once for the sign-in where that works headless, stores the resulting credentials encrypted, and collects over the HTTP endpoints those CLIs call, with routes taken from [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and [OpenUsage](https://github.com/robinebers/openusage). Users should not need a laptop helper, terminal commands or copied browser cookies.

Most quota endpoints are private interfaces the official CLIs call. Headroom labels them, gates them behind per-provider flags and is designed for personal self-hosted use only. See [ADR 0001](docs/decisions/0001-direct-provider-clients.md).

Support multiple accounts per provider, including separate Codex personal and business accounts. Record usage snapshots in a database so history survives restarts. Show unavailable or stale data explicitly.

## Start here

- [Documentation index](docs/README.md): read the specification and research in order.
- [ADR 0001](docs/decisions/0001-direct-provider-clients.md): the direct-client design and its policy posture.
- [Product scope](docs/product.md): requirements, exclusions and acceptance criteria.
- [Provider matrix](docs/providers/README.md): access methods and remaining gaps.
- [Connection lifecycle](docs/architecture/connections.md): Connect, validate, persist and refresh.
- [Roadmap](docs/roadmap.md): the ordered implementation backlog.
- [Research evidence](docs/research/evidence.md): what was checked and what remains unproven.

## Repository commands

Tool versions come from `mise.toml`. Install mise, then:

```sh
mise install          # Bun 1.4.2
mise run install      # bun install --frozen-lockfile
mise run check        # docs, format, lint, typecheck, knip, test
mise run build        # dist/headroom single binary
mise run dev          # server with reload
mise run smoke        # drive the binary through sign-up and a cancelled Codex login (needs codex on PATH)
mise run docker       # build the container image
```

`make check` runs the same gate. The docs check validates internal Markdown paths, anchors, structure, provider coverage and canonical state names; it does not prove external links or provider integrations work. No command contacts a provider. See [ADR 0002](docs/decisions/0002-stack-and-tooling.md) for the tooling.

The project is registered with PM as `headroom`. On a machine with PM configured, use `pm z headroom` to select it. PM is a maintainer convenience, not a future end-user requirement.

## Implementation status

| Area | Status |
| --- | --- |
| PM registration and Git repository | Created locally |
| Product, architecture, provider research and validation plan | Written |
| Workspace, lint, format, typecheck, tests, CI | Scaffolded; `mise run check` passes |
| Configuration, SQLite schema and embedded migrations | Implemented |
| Encrypted credential store, leases, Better Auth owner sign-in with username, password and passkeys | Implemented |
| Connector contract and attempt/connection lifecycle | Implemented |
| Connect orchestration, scheduler, snapshots and API | Implemented |
| Codex connector: CLI login, auth.json import, usage, reset credits, refresh | Implemented against fixtures; live validation pending |
| Grok connector: CLI login, auth.json import, weekly pool, cap, refresh | Implemented against fixtures; live validation pending |
| Vercel AI Gateway connector: API key, credits, spend report | Implemented against the official SDK; live validation pending |
| Claude connector: CLI login with pasted code, .credentials.json import, usage windows, scoped limits, extra usage, reset grants, refresh; off by default | Implemented against fixtures; live validation pending |
| Antigravity connector: direct Google OAuth with pasted redirect, quota summary pools, refresh, revoke | Implemented against fixtures; live validation pending |
| Copilot, Cursor | Not implemented |
| Web UI: setup, sign-in with passkeys, connect wizard, connections, detail, account | Implemented, functional only |
| Docker packaging and production deployment | Planned |
| Public repository, release and domain | Not created |

TypeScript on Bun, SQLite and a single compiled binary are the stack in [ADR 0001](docs/decisions/0001-direct-provider-clients.md) and [ADR 0002](docs/decisions/0002-stack-and-tooling.md). The server currently serves only a health endpoint.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before supplying provider evidence. Original project material uses the [MIT license](LICENSE). Third-party tools retain their own licenses and provider terms.
