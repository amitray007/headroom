# GitHub Copilot

> Reviewed: 2026-10-01. This page separates individual account quota from organization billing totals.

## Scope and recommendation

Primary route: a direct in-process TypeScript client per [ADR 0001](../decisions/0001-direct-provider-clients.md). Headroom runs the GitHub OAuth device flow itself with a public CLI client id, stores the token encrypted, and reads usage from `GET https://api.github.com/copilot_internal/user` with the header set from OpenUsage [S5][S6]. Connections use scope `individual` and auth method `device_code`.

Per OpenUsage, any GitHub OAuth token works for that endpoint, including the one `gh auth login` produces. The `gh` CLI public client id is therefore a candidate next to the Copilot CLI id. Read the id from source at implementation and record it as unvalidated until a live check passes.

A user who already has a laptop login can use auth method `import`: paste `~/.config/github-copilot/apps.json` or the token from a `gh` `hosts.yml` (next step `paste_file`). OpenUsage reads both files [S5].

That endpoint is private and GitHub publishes no terms for it. Headroom is personal self-hosted software, the connector ships behind a per-provider enable flag, and every metric from it carries the interface label `private`. If GitHub changes the endpoint or revokes the token, the connection shows `reconnect_required`.

Organization totals use the official billing REST API in a separate `organization` connection. The official Copilot SDK (`account.getQuota`) documents the same quota fields as the private endpoint and stays as a fallback.

Treat account quota, session metrics, organization billing, and analytics as separate products. Never reuse an individual token for organization reporting.

## Evidence status

| Claim | Evidence level | Basis |
| --- | --- | --- |
| Headroom's connector runs the GitHub device flow with the gh CLI's public client id and the `read:user` scope, imports `apps.json`, reads identity from `/user`, and maps `copilot_internal/user` into credits percent used, personal credits count, extra usage, chat and completions with the unlimited sentinel; tokens are not refreshable and revocation needs a client secret Headroom lacks | source-inspected | Implemented 2026-10-01 against synthetic fixtures from OpenUsage source; whether the gh client id and `read:user` scope satisfy the endpoint is unvalidated |
| Copilot CLI supports device-code login | documented | [S1] |
| SDK exposes account quota through `account.getQuota` | documented | [S2] |
| SDK quota shape: `quotaSnapshots` with `entitlementRequests` (`-1` is unlimited), `usedRequests`, `remainingPercentage`, `resetDate` | documented | [S2] |
| Session usage and context events exist | documented | [S2] |
| Several quota and metrics methods are experimental | documented | [S2] |
| Organization usage data has different administrative controls | documented | [S3] |
| `GET /copilot_internal/user` accepts `Authorization: token <github token>` plus VS Code-style client headers | source-inspected | [S5][S6] |
| Since June 2026 all Copilot plans bill by AI credits; paid plans return a credits percent remaining and an extra-usage count, with chat and completions unlimited | source-inspected | [S5] |
| Free plans return fixed chat and completions counts and no credits | source-inspected | [S5] |
| Org-managed Business or Enterprise seats return no per-seat percent; `premium_interactions` may carry `credits_used` with `entitlement` 0 | source-inspected | [S5] |
| Any GitHub OAuth token works, including the `gh auth login` token | source-inspected | [S5] |
| `GET /orgs/{org}/settings/billing/usage/summary` reports Copilot AI-credit usage for org owners and billing managers | documented | [S4] |
| The public client id of the `gh` CLI works for a third-party device flow with `read:user` | validated | Headroom's device flow completed on 2026-10-01 with Amit's account |
| A token from that flow is accepted by `copilot_internal/user` with the pinned headers | validated | 200 on 2026-10-01 with `copilot_plan`, `quota_reset_date`, `token_based_billing` and `quota_snapshots.{chat, completions, premium_interactions}` each carrying `entitlement`, `remaining`, `percent_remaining`, `unlimited`, `overage_count`, `credits_used`; the synthetic fixture `usage-live-shape.json` mirrors it |
| A prior account returned an entitlement, used interactions, and percentage remaining | prior observation | Sanitized earlier research; not a current test |

## Metrics

| Metric | Availability | Unit and source | Notes |
| --- | --- | --- | --- |
| Credits percent | `unknown` until validated | `copilot_internal/user` credits percent remaining, converted to used [S5] | `private`. Paid plans only. Keep it a percentage; do not convert to money or a count. |
| Extra usage | `unknown` until validated | Extra-usage count from the same response [S5] | `private`. Separate unit from the percent. |
| Chat | `unknown` until validated | Paid plans: unlimited. Free plans: fixed count [S5] | `private`. Keep separate from completions. `-1` or the unlimited signal stores `unlimited = true`. |
| Completions | `unknown` until validated | Same as Chat [S5] | `private`. Do not add to chat. |
| Org credits | `not_authorized` for ordinary members | `premium_interactions` `credits_used` when `entitlement` is 0 on an org-managed seat [S5] | `private`. Show as a plain count. No per-seat percent exists. |
| Org spend | `not_authorized` for ordinary members | `GET /orgs/{org}/settings/billing/usage/summary` [S4] | `official`, scope `organization`. Org-wide, not per seat. Needs org owner or billing manager. |
| Plan | `unknown` until validated | Plan name in the same response [S5] | `private`. |
| Reset | `unknown` until validated | Reset countdown when the response includes one [S5]; SDK `resetDate`, ISO 8601 [S2] | `private` on the direct route. Attach it to its bucket. Absence means `unknown`, not zero. |
| Dollar balance | `unsupported` | Not returned by `copilot_internal/user` [S5] | Do not derive money from credits. |
| Weekly limit | Not documented | Not available | Do not invent one. |
| Session/context usage | Available during an SDK session only | `assistant.usage`, `session.usage_info` | Telemetry, not an allowance. `official`. Not collected on the direct route. |
| Banked reset count and reset redemption | Not documented | Not available | Unavailable for v1. |
| Usage history | Session totals in the SDK; org reports separately | `session.usage.getMetrics`; org billing summary | `official`. Keep scopes separate. |

## Connect workflow

1. The owner picks Copilot. Headroom creates an expiring attempt (`created`) with the device authorization state stored encrypted in the attempt row.
2. The connector calls `POST https://github.com/login/device/code` with the public client id. The next step is `device_code`: verification URL, user code and expiry. The device polling credential never reaches the browser. The attempt moves to `awaiting_user`.
3. GitHub handles password, MFA, passkeys and organization authorization on its own page.
4. Headroom polls `POST https://github.com/login/oauth/access_token` at the interval GitHub returns. Handle `authorization_pending`, `slow_down`, denial and expiry. A denial gives `failed`. An elapsed deadline gives `expired`. The owner can end the attempt with `cancelled`.
5. On approval the attempt moves to `validating`. The connector makes one read-only `GET https://api.github.com/copilot_internal/user` with the pinned headers. No model request is made.
6. The attempt becomes `succeeded`. Headroom stores the encrypted token and a first snapshot with scope `individual`. The connection is `ready`. If the token works but the usage read fails, it is `partial` with the failing capability recorded.

### Import (`import`)

The next step is `paste_file`. The owner pastes `~/.config/github-copilot/apps.json` or a `gh` `hosts.yml` token. The attempt moves to `validating`. Headroom extracts the token, validates it with the same read, re-encrypts it and discards the pasted file. The result is the same as steps 5 and 6 above.

### Organization

An admin who adds organization reporting creates a separate `organization` connection with its own token. Call `GET /user/orgs`, then `GET /orgs/{org}/settings/billing/usage/summary` for each org until one reports Copilot AI-credit usage. Label every record `official` and `organization`. An ordinary member gets `not_authorized`, not zero. If several orgs report usage, the next step is `select_account`.

### Official CLI fallback

If the direct route fails validation, run `copilot login --device-code` in a managed worker with a connection-specific `COPILOT_HOME`. Show its approval URL and code. Then start the pinned Copilot SDK against the same store, which spawns the CLI, so pass `COPILOT_HOME` to that child process. Call `account.getQuota`. Save the snapshot with scope `individual` and stop the worker without issuing logout. Do not inherit `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`. This route is not on the refresh path.

## APIs and tools

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| Device code request | `POST https://github.com/login/device/code` | `official` (GitHub OAuth device flow) | Start sign-in with a public CLI client id. Id: unvalidated. |
| Device token poll | `POST https://github.com/login/oauth/access_token` | `official` (GitHub OAuth device flow) | Exchange the device code for a token. |
| Usage read | `GET https://api.github.com/copilot_internal/user` | `private` | Credits percent, extra usage, chat, completions, plan and reset [S5][S6]. |
| Org list | `GET /user/orgs` | `official` | Find candidate orgs for the `organization` connection. |
| Org billing summary | `GET /orgs/{org}/settings/billing/usage/summary` | `official` | Copilot AI-credit usage, org-wide [S4]. Owner or billing manager only. |
| Copilot SDK `account.getQuota` | In-process SDK call, spawns the CLI | `official` | Fallback quota read. Pin the SDK. |
| `assistant.usage` and `session.usage_info` events | SDK events | `official` | Need a running session. Not used on the direct route. |
| `session.usage.getMetrics` | SDK call | `official` | Experimental SDK surface. |

Pinned request headers for the usage read [S5][S6]:

- `Authorization: token <github token>`. This is the `token` scheme, not Bearer.
- `Accept: application/json`
- `Editor-Version: vscode/1.96.2`
- `Editor-Plugin-Version: copilot-chat/0.26.7`
- `User-Agent: GitHubCopilotChat/0.26.7`
- `X-Github-Api-Version: 2025-04-01`

Keep the header set in one file. The login CLI stores its token in the system credential store, or in a plaintext file under `~/.copilot/` or `COPILOT_HOME` when no store exists [S1]. Headroom does not read that store.

### Refresh and reconnect

GitHub OAuth App device-flow tokens, including the ones the `gh` CLI obtains, carry no refresh token and no expiry unless the app enables expiring tokens; treat the credential as `not_refreshable` and mark this unvalidated for the chosen client id. A 401 from `copilot_internal/user` is immediately definitive and sets `reconnect_required` with `token_rejected`. A 403 or an org-managed-seat response is a capability result. Reconnect repeats the device flow or accepts a pasted token file; the GitHub login must match.

## Available packages and limits

| Package or tool | Value | Limit |
| --- | --- | --- |
| OpenUsage Copilot provider | Adopted endpoint and header reference (D19) [S5][S6] | Swift, MIT. Reads local credentials; Headroom does not. |
| Official Copilot CLI | Source of a public client id; fallback device authentication | Isolate the store per connection with `COPILOT_HOME`; do not inherit `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`, which the CLI reads first [S1]. |
| `gh` CLI | Candidate public client id; source of `hosts.yml` import | Id unvalidated. |
| Official Copilot SDK | Structured quota and session telemetry; documents the quota field shape | Some APIs are experimental. Spawns the CLI. |
| GitHub OAuth App | Optional own client id | Requires operator configuration. Not needed for the first release. |

## Prior observations

Earlier account research used a compatible CLI and SDK to obtain a read-only account quota response with an entitlement, consumed premium interactions, and a remaining percentage. Values, fields, and availability were account-specific. This was not an organization billing test and does not prove an equivalent result for every plan. It did not test the direct endpoint.

## Cannot promise

- `copilot_internal/user` stays available, keeps its shape, or keeps accepting the same client headers. It is private.
- The pinned editor and plugin versions stay accepted.
- The public client id keeps working for third-party device flows, or its token reaches the usage endpoint.
- A token can be revoked from Headroom. No logout command or GitHub revocation endpoint is documented.
- The usage endpoint exposes a dollar balance or monthly allowance in money.
- An org-managed seat shows a per-seat percent.
- An individual authorization can read organization billing.
- Every organization policy permits device login or Copilot access.
- Experimental SDK fields remain stable across versions.

## Implementation and validation checklist

- [ ] Read the `gh` and Copilot CLI public client ids from source and record them, with the source version, in the connector.
- [ ] Test the device flow from a browser separate from the server host, including denial, expiry and `slow_down`.
- [ ] Validate `GET /copilot_internal/user` with the pinned header set and the `token` scheme; record which headers are required.
- [ ] Test a paid plan, a free plan and an org-managed seat. Confirm the credits percent, count and `entitlement` 0 behavior.
- [ ] Convert credits percent remaining to used. Keep percent, count and money in separate units.
- [ ] Test `import` of `apps.json` and `hosts.yml` tokens.
- [ ] Test token persistence across a process restart and a repeat collection. When GitHub invalidates the token, expect `reconnect_required` and a kept old snapshot.
- [ ] Add synthetic fixtures for success, partial response and schema drift. Return `invalid_response` for a changed shape.
- [ ] Mark missing reset and billing fields `unknown`, not zero. Map the unlimited signal to `unlimited = true`.
- [ ] Test a non-admin member and an authorized `organization` connection separately, each with its own token. A member gets `not_authorized`.
- [ ] Disconnect deletes the credential row and records `local_only` unless a GitHub revocation endpoint is validated.
- [ ] Keep the SDK fallback documented and pinned, but do not build it unless the direct route fails.

## Sources

1. [S1: Copilot CLI command reference, official](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) - device-code login and credential storage. Reviewed 2026-10-01.
2. [S2: Copilot SDK usage and billing metrics, official](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing) - quota, session metrics, and experimental API notice. Reviewed 2026-10-01.
3. [S3: Copilot organization metrics, official](https://docs.github.com/en/copilot/concepts/billing/copilot-usage-metrics) - organization-level reporting scope. Reviewed 2026-10-01.
4. [S4: GitHub billing usage REST API, official](https://docs.github.com/en/rest/billing/usage) - organization usage summary endpoint and its owner or billing-manager requirement. Reviewed 2026-10-01.
5. [S5: OpenUsage Copilot provider notes, community](https://github.com/robinebers/openusage/blob/main/docs/providers/copilot.md) - credits vocabulary, plan behavior, token sources and endpoint. Reviewed 2026-10-01.
6. [S6: OpenUsage CopilotUsageClient.swift, community](https://github.com/robinebers/openusage/blob/main/Sources/OpenUsage/Providers/Copilot/CopilotUsageClient.swift) - request headers and response parsing. Reviewed 2026-10-01.
