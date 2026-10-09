# Validation plan

A provider becomes supported only after its connection and requested data work in the intended deployment. Source research is a prerequisite, not an end-to-end test.

## Shared acceptance checks

| Area | Check | Passing evidence |
| --- | --- | --- |
| Policy label | Confirm each metric's interface label and the provider's published stance | Dossier and capability rows agree; private connectors sit behind a flag |
| Fresh login | Start with no stored credentials | Browser approval completes from a device other than the server |
| CLI login | Run the pinned CLI headless on Linux in an empty directory | Login completes without a keyring, writes the expected file, and the directory is deleted afterwards |
| Import | Paste a synthetic auth file with a wrong shape, then a valid one | Wrong shape is rejected without storage; valid one yields identity and a snapshot |
| Remote browser | Approve from a device separate from the server | No unreachable localhost redirect is required; pasted redirect works where used |
| Identity | Read account or workspace identity and compare on refresh | Snapshot belongs to the selected connection |
| Persistence | Restart the process and collect again | Credentials and refresh state survive; no re-login |
| Refresh | Force token expiry, then collect | Connector refreshes and persists rotated credentials before using them |
| Revocation | Revoke the token at the provider | Connection becomes `reconnect_required` with `token_rejected` or `refresh_rejected`; prior snapshot keeps its observation time |
| Classification | Replay 401, 403, 412, 429, 5xx and a schema-drift body through the connector | Only definitive classes change state; transient ones only record the run; capability ones mark one metric |
| Staleness | Keep a connection failing transiently past the threshold | Card shows data age and a stale notice; no Reconnect offered |
| Reconnect | Reconnect with the same account, then with a different account | Same account replaces credentials and keeps history; different account fails with `identity_changed` |
| Provider-side invalidation | Sign in to the same provider elsewhere after connecting | Record whether Headroom's token survives; if not, it becomes a definitive failure, not a loop |
| Isolation | Run two accounts concurrently | No credential, attempt or snapshot crossover |
| Permissions | Use non-admin and restricted accounts | Partial capabilities are accurate; no organization data leaks |
| No inference | Observe every request during validation and collection | No model request or billable prompt |
| Failure | Expire, deny and cancel login; simulate 429 and 5xx | Bounded requests, correct backoff, safe cleanup |
| Freshness | Fail a collection after a good one | Old snapshot retains its observation time |
| Secrets | Inspect responses, logs and fixtures | No keys, refresh tokens, codes or URLs with codes |
| Disconnect | Remove the connection | Jobs stop, credential row deleted, revocation result recorded |
| Schema drift | Replay synthetic responses with missing and new fields | Unknown data never becomes zero or a fabricated metric |

Do not conduct live account checks until the account owner authorizes them. Agents never run one with real credentials; the maintainer's live runs are recorded in the [evidence register](research/evidence.md).

## Provider-specific gates

| Provider | Required proof before support |
| --- | --- |
| Codex | Device flow, identity claims, `wham/usage` buckets and credits, reset-credit inventory, refresh, revocation |
| Claude | Enable flag, CLI login with pasted code, `api/oauth/usage` buckets and reset grants, refresh, no model request, `setup-token` rejected |
| Cursor | Approval polling and refresh, usage summary pools and cycle, member versus admin scope, admin pagination and range limit |
| Copilot | Device flow with a public CLI client id, `copilot_internal/user` with the documented headers, AI-credits percent and reset, org-managed seat handling, org billing REST for owners only |
| Vercel | Gateway key scope, pinned `@ai-sdk/gateway` version, balance and total used, team selection, spend report plan gate |
| Grok | CLI device login, refresh at `auth.x.ai`, weekly pool and cap from the billing route, 412 on team logins handled as `partial`, management API balance as a separate connection |
| Antigravity | Google OAuth with pasted redirect, project id, `retrieveUserQuotaSummary` buckets and resets, refresh, credits stay unknown |

## Reset action checks

Validate reads first. Use a synthetic transport for ordinary tests of redemption. A live redemption consumes a user's resource and needs separate explicit authorization.

Test eligibility changes, double submission, concurrent refresh, timeouts after submission and process crashes. Use a provider idempotency key where supported. If success cannot be determined, mark the result `uncertain` and reconcile before any retry.

## Evidence record

For each executed check, record date, connector version, platform, flow, account category, operation, redacted result and remaining limitation. Keep account identifiers out of public records. Never publish tokens or raw responses.

See [the evidence register](research/evidence.md) for earlier conversation observations and the proof boundary of this repository.
