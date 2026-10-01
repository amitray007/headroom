# Decision register

This register distinguishes user requirements from implementation proposals. Date: 2026-10-01.

| ID | Decision | Status | Reason / consequence |
| --- | --- | --- | --- |
| D01 | Open-source, self-hosted web dashboard | User requirement | The user controls the deployment and account data |
| D02 | Browser Connect; no mandatory laptop helper | User requirement | Put integration setup on the host and keep provider approval in the browser |
| D03 | Exclude Zed | User requirement | Avoid research and implementation outside the requested scope |
| D04 | Separate provider dossiers and shared architecture | Implemented in repository | Provider facts change independently |
| D05 | Use Headroom as the project name | User approved | Selected on 2026-10-01; no brand/domain clearance |
| D06 | Prefer official account protocols; ACP optional | Proposed | ACP does not expose all requested account metrics |
| D07 | Persist snapshots; keep credential ownership explicit | Proposed | History and reconnect must survive process exit |
| D08 | Start with a Codex connection proof through the official app-server | Superseded by [ADR 0001](0001-direct-provider-clients.md) | The app-server worker design is replaced by a direct device-code client; Codex stays first |
| D09 | TypeScript and single-host Linux deployment | Confirmed in revised [ADR 0001](0001-direct-provider-clients.md) | TypeScript on Bun; a Go variant was considered on 2026-10-01 and rejected because the reusable packages are TypeScript |
| D10 | SQLite for the first single-host instance | Proposed | Embedded, no cgo, WAL mode; revisit only if a second host appears |
| D11 | MIT for original project material | Applied | Community dependencies and vendor binaries keep their own terms |
| D12 | Reset actions follow read-only monitoring | Proposed | A mutation has different permissions and retry semantics |
| D13 | Official CLI for sign-in only, direct HTTP for refresh and collection | Proposed; see [ADR 0001](0001-direct-provider-clients.md) | CLIs never run on the refresh path; Antigravity uses a direct client; private endpoints labelled and flag-gated |
| D14 | Single dashboard owner in the first release | Proposed | Removes worker tenancy; per-connection isolation remains mandatory |
| D15 | Credentials encrypted at rest in SQLite with an external key file | Proposed | One credential writer per connection; CLIProxyAPI's plaintext files are an optional import, not the store |
| D16 | Private-interface connectors ship behind per-provider enable flags; Claude off by default | Proposed | Policy posture in ADR 0001; the owner opts in per provider |
| D17 | Drop Fireworks | User decision 2026-10-01 | Prepaid balance has no documented route; the private gRPC path is not worth validating for one provider |
| D18 | Credential import of existing CLI or CLIProxyAPI auth files | Proposed | Replaces any laptop-side collector; re-encrypted on paste |
| D19 | Usage endpoints and headers taken from OpenUsage source | Proposed | Most precise current reference; Grok and Copilot routes revised from it |
| D20 | No virtual shell as the CLI runner | Decided 2026-10-01 | just-bash cannot execute native binaries; use `Bun.spawn` or a pseudo-terminal |
| D21 | Stack and tooling baseline: Bun, Hono, Zod, Drizzle on SQLite, Oxlint type-aware, Oxfmt, Knip, TypeScript 7, mise, GitHub Actions | Applied; see [ADR 0002](0002-stack-and-tooling.md) | `mise run check` is the single gate |

## Decisions still needed

Amit must confirm the revised ADR 0001 (TypeScript on Bun, CLI sign-in with HTTP collection, single owner, Codex first) before implementation starts. After that, the first milestone fixes the exact packages, migration approach, session mechanism and encryption primitive; those are implementation picks recorded in the milestone, not new decisions.

When a proposal is accepted or replaced, update this register and its owning design document. Add a separate decision record only when the rationale is too substantial for this table.
