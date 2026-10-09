# Tools and packages

This catalog records reusable candidates from the research. Headroom depends on `@ai-sdk/gateway` only (Vercel AI Gateway connector). It ports code from pi-cursor, CLIProxyAPI and OpenUsage and uses their endpoint references; it installs no other tool listed here. A provider listed by a tool may mean local activity parsing rather than live subscription-quota support.

Reviewed/consolidated: 2026-10-01. Recheck package versions, exports, runtime requirements and license files before adoption. Historical version observations are not recommended pins.

## Preferred provider-specific building blocks

| Tool | Useful surface | Limit / proposed role |
| --- | --- | --- |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | Go, MIT; in-process OAuth and device-code clients for Codex, Claude, Antigravity and xAI; management API that starts a login, returns a URL and polls a state; per-account JSON auth files with refresh; Codex quota parser | Reference design for [ADR 0001](../decisions/0001-direct-provider-clients.md). Its `sdk/auth` is importable but interactive; port the client constants and flows with attribution instead. Its auth files are plaintext; Headroom encrypts. It learns quota as a by-product of proxied inference, which Headroom does not do |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | Structured login, account identity, quotas, history and reset operations | Deployment/auth restrictions apply; evaluate permitted self-host use separately from hosted products |
| [Copilot SDK](https://github.com/github/copilot-sdk) and [CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) | Official device login and account quota access | Version/account behavior needs testing; not a general organization billing replacement |
| [AI Gateway SDK](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) | `getCredits()`, `getSpendReport()`, generation details | Credit helpers require Gateway key or OIDC; no proof of a universal monthly allowance |
| [pi-cursor](https://github.com/Rahularya01/pi-cursor) | Browser PKCE/poll login, refresh and period-usage request | Unofficial private interfaces; avoid pulling in its entire inference path for monitoring |
| [Grok CLI](https://github.com/xai-org/grok-build) | Official remote device login and credential refresh | Consumer subscription quota still needs a separate collector |
| [Antigravity CLI](https://antigravity.google/docs/cli/reference/) | Remote login, `/usage`, `/credits`, statusline | Passive collection and Linux credential persistence remain validation work |

## Cross-provider collectors

| Candidate | Surface found in research | What remains for Headroom |
| --- | --- | --- |
| [ai-usagebar](https://github.com/akitaonrails/ai-usagebar) | Rust collector; `usage --json`; quota/reset data for several subscription families | Existing CLI credential assumptions, account isolation and private endpoints need adaptation; no Vercel solution established |
| [oh-my-pi / pi-ai](https://github.com/can1357/oh-my-pi/tree/main/packages/ai) | Importable usage-provider functions and Claude/Codex reset helpers | Credential lifecycle and provider permission remain our responsibility; reviewed package depends on Bun/native components |
| [onWatch](https://github.com/onllm-dev/onwatch) | Existing web UI, SQLite history, alerts and provider collectors | Closest dashboard reference; fresh server login and account isolation are separate work; GPL-3.0 implications if reused |
| [OpenUsage by robinebers](https://github.com/robinebers/openusage) | Swift, MIT; reads existing CLI credentials and calls the exact usage endpoints the CLIs call, with headers, for Claude, Codex, Copilot, Cursor, Grok and Antigravity; `docs/providers/*.md` documents each route | Best endpoint reference; adopted as the source for the Grok and Copilot routes (D19). No login flows, so nothing to reuse for Connect; a macOS app, so reference only |
| [CodexBar](https://github.com/steipete/CodexBar) | Multi-provider usage CLI and serving patterns | Provider/platform parity varies; Cursor dashboard path needs a separate check |
| [quota-axi](https://github.com/kunchenguid/quota-axi) | CLI JSON for subscription quotas; prior reviewed package lacked exported fetch APIs | Treat as a CLI/reference candidate, not an importable SDK; see evidence note below |
| [Tokscale](https://github.com/junhoyeo/tokscale) | Activity accounting and live usage command | Activity-provider coverage exceeds quota coverage; logs do not establish account limits |
| [OpenUsage.sh](https://github.com/janekbaraniewski/openusage) | Go collector and CLI JSON research candidate | Different project from robinebers/OpenUsage; internal Go packages were not a public integration SDK |
| [shuvquota](https://github.com/shuv1337/shuvquota) | Lightweight quota CLI/web endpoint research candidate | No complete Cursor/Copilot/Vercel coverage established |
| [ellite/openusage](https://github.com/ellite/openusage) | Docker dashboard and Claude balance research candidate | Uses browser-session or cURL import, a different connection model from Headroom's; GPL-family license requires review |
| [caut](https://github.com/Dicklesworthstone/coding_agent_usage_tracker) | Broad advertised coverage in earlier research | Earlier research found narrower implemented coverage than advertised; check current coverage and the license text before any adoption |

These projects change independently. The linked repositories establish identity; recheck the specific implementation and license at adoption. In particular, prior caut research reported narrower implemented coverage than its advertising; a later repository review describes additional providers. The current supported metric paths must be established from code before choosing it.

## Reuse decisions

Use the smallest supported provider building block. Reuse parsing and normalization patterns from collectors after checking their licenses. Do not adopt a full inference framework just to read quotas unless its maintenance savings outweigh the runtime and dependency cost.

The research observed MIT licensing for ai-usagebar, pi-ai and pi-cursor, and Apache-2.0 for the AI Gateway package. Verify the exact version's license when adding it. Headroom's MIT license does not relicense third-party code, vendor binaries or service access.

`ai-usagebar` exposes a common report shape, but some values are formatted strings and reset blocks can be omitted. Preserve absent-versus-zero semantics. A CLI's output schema is an adapter contract to test, not permission to assume every provider has every field.

The prior pi-ai review found provider-specific reset-list/consume helpers and richer reset metadata. Treat those as source evidence. A callable private operation still needs identity, eligibility, user-action and retry checks before exposure.

## just-bash

[just-bash](https://github.com/vercel-labs/just-bash) is a virtual bash with an in-memory filesystem for agents. It runs its own TypeScript command implementations and cannot execute a native binary, so it cannot run `codex`, `claude` or `grok` for a sign-in. Rejected as the CLI login runner (D20). The runner is `Bun.spawn` or a pseudo-terminal with an allowlisted environment.

## Adoption gate

Before selecting a package, prove the required metric exists; verify fresh remote login, credentials after restart, account identity and isolation; inspect the license and supported runtime; pin a version; add synthetic fixtures for schema drift; and record the maintenance owner. No package found so far removes all of those responsibilities.
