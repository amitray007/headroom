# Provider findings

Research baseline: 2026-10-01. All seven connectors are implemented; each dossier records which findings are validated against a live account and which are not. The matrix is a map of the evidence, not a support promise. Connection methods follow [ADR 0001](../decisions/0001-direct-provider-clients.md): an official CLI may run once for sign-in, collection is always direct HTTP.

## Connection matrix

| Provider | Proposed connection | Main metric source | Outstanding gate |
| --- | --- | --- | --- |
| [Claude](claude.md) | Official CLI login via the runner, or import `.credentials.json`; on by default, highest policy risk | `api/oauth/usage` (private) | Read Anthropic's terms; headless `claude` login on Linux to prove |
| [Codex](codex.md) | `codex login --device-auth` via the runner, or import `auth.json` | `wham/usage` and reset credits (private) | First connector; personal self-hosted posture |
| [Cursor](cursor.md) | pi-cursor approval with polling; admin API key | Dashboard RPC with REST fallbacks (private); admin API (official) | pi-cursor must run without the pi runtime; admin key is write-capable |
| [Copilot](copilot.md) | GitHub device code with a public CLI client id, or import a gh token | `copilot_internal/user` (private); org billing REST (official) | AI-credits model since June 2026; org seats return no per-seat percent |
| [Vercel AI Gateway](vercel-ai-gateway.md) | Gateway API key | `@ai-sdk/gateway` `getCredits` and `getSpendReport` (official) | Team selection; spend report is Pro and Enterprise only |
| [Grok](grok.md) | `grok login --device-auth` via the runner, or import `auth.json`; management API key | `cli-chat-proxy.grok.com/v1/billing` (private); prepaid balance (official) | Team logins answer 412; unified weekly billing only |
| [Antigravity](antigravity.md) | Direct Google OAuth plus pasted redirect | `retrieveUserQuotaSummary` (private) | `agy` needs a Linux keyring; credits unknown |

## Reading a dossier

Each provider file separates metrics from authentication. A documented login method does not guarantee that it exposes every account metric. Community source can demonstrate a mechanism without making it an official integration.

The banked-reset inventory is separate from the next renewal time. Personal monthly usage is separate from a team admin's configured spending cap. API billing is separate from a consumer subscription even when both belong to the same company.

## Evidence levels

- **Documented:** described in provider documentation or a published protocol.
- **Source-inspected:** present in code, including community code using private endpoints.
- **Prior observation:** reported in earlier research, not reproduced in this repository.
- **Validated:** proven by a Headroom check recorded in the evidence register.
- **Unvalidated:** a required deployment or account-specific check remains.

See [the evidence register](../research/evidence.md) for the exact proof boundary. Zed is deliberately excluded. Fireworks was dropped on 2026-10-01: its only balance route is a private gRPC call and spend alone was not worth a connector.
