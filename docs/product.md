# Product scope

Headroom will give a user one view of the allowances, credits and usage exposed by their connected AI accounts. It is an open-source web application intended for self-hosting.

## Requirements

| Requirement | Acceptance criterion |
| --- | --- |
| Browser account connection | A user approves a provider login or enters a key without installing a laptop helper |
| Multiple accounts | Each provider account and workspace has its own identity, credentials and card |
| Reported allowances | Display provider-reported session, hourly, weekly, monthly and model-specific buckets where available |
| Credits and spending | Distinguish remaining money, nonmonetary credits, spend and spending caps |
| Reset inventory | Show banked redeemable resets separately from a bucket's reset timestamp |
| Historical view | Persist timestamped snapshots and identify gaps and stale data |
| Admin and nonadmin use | A personal connection works without claiming access to organization-wide analytics |
| Recovery | Three owner actions only: Connect, Reconnect, Disconnect. Reconnect appears only on a definitive credential failure with its reason; transient failures show data age, not a prompt |
| Self-hosting | Document persistent storage and deployment; the container image bundles required CLI binaries and a bare-metal host installs them |
| Later account actions | Expose redemption only after support and failure behavior are validated |

The requested starting provider families are Claude, Codex, Cursor, Copilot, Vercel AI Gateway, Grok and Antigravity. Zed is excluded. Fireworks was removed on 2026-10-01 because its prepaid balance has no documented route and the private gRPC path was not worth validating.

## What a connection means

A successful login proves authentication. It does not prove every desired metric exists or is accessible. A connected account may have partial metric coverage. Each card must list its data capabilities and last successful refresh.

For device flows, the user may need to enter a short code on the provider's site. For pasted-redirect flows, they paste the URL they were redirected to, or the code it displays, into Headroom. For key-based services, they create and paste a key once. These steps are compatible with the Connect requirement; asking users to set up local CLIs is not part of the design.

## Dashboard behavior

Show provider and account labels, workspace where relevant, data age, available metric buckets and reconnect status. Use provider-reported percentages rather than deriving allowance usage from token prices or spend. A percentage without an absolute limit must remain a percentage.

Refresh is automatic. An internal refresh control may exist for diagnosis, subject to the same lease and rate limits, and is not a headline action. Keep the last valid snapshot visible during failures. Do not display missing metrics as zero or unlimited.

Keep individual and organization figures visibly distinct. Do not aggregate unrelated percentages or silently select the first team returned by an API.

## Reset actions

A reset countdown answers when a quota window renews. A reset inventory answers how many redeemable resets remain. A redemption action spends one of those resets. These are separate concepts.

Monitoring is read-only. Redemption, purchases and spending-limit changes are later features with explicit user actions, action records, account checks and provider-specific retry rules. Never assume every provider offers a reset API because one does.

## Exclusions for the first version

Headroom will not proxy inference, rotate accounts to evade limits, require users to route AI activity through it, or claim to reconstruct complete billing history from local token logs. It will not make model calls to validate a connection.

The first milestone is a real connect-and-refresh proof, not a chart-filled mock dashboard. Third-party product names and prices are metadata, not hardcoded entitlements.

## Open product decisions

- Final public name and domain.
- Whether the first deployment supports only one owner or multiple dashboard users. Account isolation remains required in either case.
- History retention and alert thresholds.
- Which private-interface connectors ship enabled by default. Current proposal: all off except Codex; Claude requires an explicit opt-in.
- Public release channel and support policy.
