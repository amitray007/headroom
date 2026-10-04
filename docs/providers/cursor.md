# Cursor

> Reviewed: 2026-10-01. Cursor has a documented admin API; member usage collection and browser sign-in are private interfaces. The current docs name the official CLI binary `agent`; older material and community code call it `cursor-agent`.

## Scope and recommendation

Primary route: direct in-process TypeScript clients per [ADR 0001](../decisions/0001-direct-provider-clients.md). Support two explicitly different Cursor connections.

- **Member connection (scope `member`):** Headroom runs the browser-approval sign-in with the `@rahularya01/pi-cursor` package (MIT, TypeScript): PKCE, provider polling and token refresh (auth method `approval_poll`, next step `open_url`). It reads the member's own usage and reads the member's own usage. Every endpoint is `private`. Cursor publishes no terms for these endpoints. Headroom is personal self-hosted software, the member connector ships behind a per-provider enable flag, and a changed endpoint or revoked token shows `reconnect_required`.
- **Team admin connection (scope `team_admin`):** accept a Cursor Admin API key that an administrator creates in Cursor (next step `api_key`). Use the documented, read-only admin endpoints. Interface label `official`.

Do not treat a team's spend cap as a member's included monthly allowance. Do not imply that a non-admin user can authorize team-wide data.

The official `agent login` CLI is the fallback for members.

## Evidence status

| Claim | Evidence level | Basis |
| --- | --- | --- |
| Headroom's member connector ports pi-cursor's PKCE login (`loginDeepControl` with S256 challenge, `auth/poll` returning 404 until approved, `exchange_user_api_key` refresh) and reads `DashboardService/GetCurrentPeriodUsage` with the Connect protocol header: total, Auto and API percent, included limit, on-demand spend and limit in cents | source-inspected | Implemented 2026-10-01 against synthetic fixtures; the admin-key connection is not built |
| `agent login` uses browser login and stores credentials locally; the location is undocumented | documented | [S1] |
| API key login is supported for automation | documented | [S1] |
| Admin API uses an admin-created API key and reads usage/spending | documented | [S2] |
| Admin API also exposes mutating endpoints and per-endpoint rate limits | documented | [S2]; `user-spend-limit`, `remove-member`; 30-day maximum query range |
| Team members can see their own remaining included usage | documented | [S3] |
| Two monthly usage pools and reset timing are shown in the dashboard | documented | [S4] |
| Member sign-in: PKCE verifier and challenge, `https://cursor.com/loginDeepControl` in CLI redirect mode, polling `https://api2.cursor.sh/auth/poll`, refresh via `/auth/exchange_user_api_key` | source-inspected | [S6] (pi-cursor) |
| `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` returns member usage | source-inspected | [S6]; not run here |
| `GET https://cursor.com/api/usage-summary` returns the Cursor Models and Other Models pools, plan, reset, and on-demand spend and limit | source-inspected | [S7] (ai-usagebar) |
| OpenUsage reads dashboard usage over Connect RPC on `api2.cursor.sh`; the request refreshes the token and retries once after 401 or 403 | source-inspected | [S8] (OpenUsage) |
| `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus` (body `{}`, same Bearer token and Connect header) returns the Grok Bot allowance: `usagePercent`, `currentPeriodStart`, `nextResetTimestampUtc`, and `usesPooledEnterpriseAllowance`, `hasNonZeroIncludedLimit`, `includedLimitZero`, which mark an account with no personal meter | source-inspected | [S8][S9] (OpenUsage); implemented 2026-10-04 against a synthetic fixture, not yet run against a real account |
| REST fallbacks for Enterprise and team accounts: `GET https://cursor.com/api/usage` and `GET https://cursor.com/api/usage-summary`; a Stripe balance route `cursor.com/api/auth/stripe`; a usage-events CSV export at `cursor.com/api/dashboard/export-usage-events-csv` | source-inspected | [S8] |
| The REST fallback combines the included request allowance with structured percentages and user-scoped on-demand spend; neither REST response alone is the whole snapshot | source-inspected | [S8] |
| `@rahularya01/pi-cursor` `src/index.ts` re-exports its auth and usage modules, and they run without the pi runtime | unvalidated | Default export takes the pi `ExtensionAPI`; verify the modules, otherwise port them |
| Which member endpoint to adopt | validated | `DashboardService/GetCurrentPeriodUsage` answered 200 on 2026-10-01 with `planUsage.{totalSpend, includedSpend, bonusSpend, limit, autoPercentUsed, apiPercentUsed, totalPercentUsed}`, `spendLimitUsage.{pooledUsed, limitType}` and `billingCycleStart`/`End` as epoch-millisecond strings; the REST fallback stays unneeded |
| The member token from the polling flow is accepted by the dashboard endpoint | validated | Headroom's approval-poll login and first collection completed on 2026-10-01 |
| A prior dashboard response had included and on-demand figures | prior observation | Sanitized earlier research; not a current test |

## Metrics

| Metric | Availability | Unit and source | Notes |
| --- | --- | --- | --- |
| Session limit | Not a documented subscription metric | Not available | Agent telemetry is not a stable account allowance. |
| Weekly limit | Not documented | Not available | Do not synthesize it. |
| Model or pool limit | `unknown` until validated | Cursor Models and Other Models pools from `usage-summary` [S7]; total, Auto and API percentages from `GetCurrentPeriodUsage` [S6] | `private`. Plan behavior comes from [S4]. Do not equate pool names across responses. The REST fallback also adds `usage` request allowance and the Stripe balance [S8]. |
| Grok Bot allowance | Source-inspected; eligible accounts only | Percent used of a separate weekly allowance, with its reset, from `GetSandUsageStatus` [S9] | `private`. Not part of the included pools. An account without a personal allowance shows no meter, never 0%. |
| Monthly included usage | `unknown` until validated | Member endpoints above; resets with billing cycle | `private`. Unused usage does not roll over. |
| On-demand usage and limit | `unknown` until validated | `usage-summary` on-demand spend and limit [S7] | `private`. Separate from included usage. |
| Team spend | Available to admins | `POST /teams/spend` | `official`. Separate from member usage. |
| Credits | Partial | Provider-returned spending/included values | Preserve units and currency; do not convert a cap into credits. |
| Reset countdown | `unknown` until validated | Billing-cycle reset date in the member response | `private`. Attach to its bucket. |
| Banked reset count | Not documented | Not available | Unavailable for v1. |
| Reset redemption | Not documented | Not available | Unavailable for v1. |
| Usage history | Admin API available; member history depends on endpoint | `POST /teams/daily-usage-data`, `POST /teams/filtered-usage-events` | `official` for admin. Admin scope is required for team-wide reporting. |
| Admin versus non-admin | Materially different | Roles and admin API | Members see personal usage; admins see team data. Scopes are `member` and `team_admin`. |

## Connect workflow

### Member (`approval_poll`)

1. Create an expiring attempt (`created`). Generate a PKCE verifier, challenge and UUID. Store them encrypted in the attempt row.
2. Return the next step `open_url`: `https://cursor.com/loginDeepControl` with the challenge and CLI redirect mode, built by the pi-cursor `loginDeepControl` flow. The attempt moves to `awaiting_user`. The user approves on Cursor's own page. Headroom never sees the password.
3. Poll `https://api2.cursor.sh/auth/poll` through pi-cursor with the verifier until approved, denied or expired. A denial gives `failed`; an elapsed deadline gives `expired`; the owner can end it with `cancelled`.
4. On approval the attempt moves to `validating`. Read identity, then make one read-only usage call on the pinned member endpoint.
5. The attempt becomes `succeeded`. Store the encrypted tokens and a first snapshot. The connection has scope `member` and is `ready`, or `partial` if identity works but usage access fails.
6. Refresh through `/auth/exchange_user_api_key` (pi-cursor) before a collection when the token nears expiry, and on a 401. If refresh fails definitively, set `reconnect_required` and keep the old snapshot with its original time.

### Team admin (`api_key`)

1. Show instructions that link the user to Cursor's Settings > Cursor Admin API Keys. The attempt waits in `awaiting_input`.
2. The user pastes a newly created admin key once. Encrypt it immediately and never return it to the browser. The attempt moves to `validating`.
3. Verify the key with a read-only endpoint (`/teams/members`). Discover team identity and capabilities. Require `select_account` if several teams resolve.
4. The attempt becomes `succeeded`. The connection has scope `team_admin`. Poll the read-only endpoints below.

### Official CLI fallback

If the direct member flow fails validation, run `agent login` in a short-lived worker with a connection-specific store. Present the browser URL it prints and complete only through Cursor's page. The credential location is undocumented, so isolation and any read from that store are Headroom's responsibility. The CLI documents no quota API, so this fallback gives sign-in only.

## APIs and tools

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| Member sign-in | Open `https://cursor.com/loginDeepControl` in the user's browser | `private` | PKCE approval page [S6]. |
| Member poll | `https://api2.cursor.sh/auth/poll` | `private` | Poll with the verifier [S6]. Method not recorded in the source notes; confirm at implementation. |
| Member refresh | `/auth/exchange_user_api_key` on `api2.cursor.sh` | `private` | Refresh the token [S6]. Confirm method and host at implementation. |
| Grok Bot allowance | `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus` | `private` | Optional, after the usage call: `grok_bot.used_percent`, a weekly meter with its reset. 403, 404 or an ineligible account give no meter; any other failure is recorded and keeps the rest of the snapshot [S8][S9]. |
| Member usage, same RPC family | `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` | `private` | Total, Auto and API percentages, cycle boundaries, included and bonus spend [S6]. |
| Member usage, REST fallback | `GET https://cursor.com/api/usage` and `GET https://cursor.com/api/usage-summary` | `private` | Enterprise and team accounts. Pools, plan, reset, request allowance, on-demand spend and limit [S7][S8]. |
| Member balance | `cursor.com/api/auth/stripe` | `private` | Stripe balance [S8]. |
| Member usage events | `cursor.com/api/dashboard/export-usage-events-csv` | `private` | CSV export of usage events [S8]. |
| Admin members | `GET /teams/members` | `official` | Team identity check and member list [S2]. |
| Admin daily usage | `POST /teams/daily-usage-data` | `official` | Pagination option; per-team rate limit; 30-day maximum range per request [S2]. |
| Admin spend | `POST /teams/spend` | `official` | Team spending details [S2]. |
| Admin usage events | `POST /teams/filtered-usage-events` | `official` | Filtered usage events; same range limit [S2]. |
| `agent login`, `agent status` | CLI | `official` | Fallback sign-in. `agent status` shows authentication, account and endpoint; it documents no quota fields. |

Admin endpoints use Basic auth with the key as username. Only the method of `/teams/daily-usage-data` (`POST`) is recorded in earlier research. The methods shown for the other three admin endpoints are unconfirmed; check them against [S2] at implementation. The same key also grants `/teams/user-spend-limit` and `/teams/remove-member`. Both exist. Headroom never calls them or any other mutating endpoint. The adapter allowlist must contain only the four read endpoints above.

Pin one primary member endpoint after validation and keep the REST fallback. Do not equate pool names across responses, and do not mix their fields in one adapter. The two REST responses together form the fallback snapshot; neither is complete alone.

### Refresh and reconnect

Member credentials refresh through `exchange_user_api_key`, the route pi-cursor implements [S6]; OpenUsage refreshes and retries once after a 401 or 403 on the dashboard request [S8]. A second 401 is definitive and sets `reconnect_required`. Admin API keys are `not_refreshable`; a 401 is immediately definitive and Reconnect asks for a new key while keeping the team selection. Expiry for member tokens comes from the JWT `exp` claim where present, otherwise refresh is reactive only.

## Available packages and limits

| Package or tool | Value | Limit |
| --- | --- | --- |
| Official Cursor Agent CLI | Browser login and status; member fallback | Does not document an account quota API or its credential location. |
| Official Cursor Admin API | Supported team data path | Requires an admin-created organization key. |
| `@rahularya01/pi-cursor` | Used directly for PKCE `loginDeepControl`, `auth/poll` polling, `exchange_user_api_key` refresh and usage [S6] | Written as a pi extension; verify the re-exported modules run without the pi runtime. Private interfaces can change. |
| OpenUsage Cursor provider | Adopted member endpoint reference (D19) [S8] | Swift, MIT. Reads local credentials; Headroom does not. |
| `ai-usagebar` | Endpoint reference for `usage-summary` and normalization [S7] | Reads local credentials; Headroom does not. |
| `quota-axi` | Read-only CLI reference | Reuses local credential assumptions. |

## Prior observations

Earlier research observed a private dashboard response with a billing-cycle range, separate included and on-demand values, and a team spending cap. The spending cap was not treated as included quota. That response is useful as an adapter fixture shape only. It does not establish a public Cursor API contract.

## Cannot promise

- The member sign-in, refresh and usage endpoints remain available or compatible. All are private.
- Any member usage endpoint accepts a token from the polling flow, or returns the fields listed above.
- A refresh token survives indefinitely, or can be revoked from Headroom. No revocation endpoint is documented.
- A member can access team-wide data or modify team spending controls.
- All plans use the same pool names, request model, or included allowance.
- The admin API exposes every dashboard chart or per-member limit.

## Implementation and validation checklist

- [ ] Implement the Admin API connection first. It is the only `official` route.
- [ ] Allowlist only `/teams/members`, `/teams/daily-usage-data`, `/teams/spend` and `/teams/filtered-usage-events`. Add a test that no other admin path can be called.
- [ ] Paginate team daily usage and enforce the 30-day range. Respect rate limits and `Retry-After`.
- [ ] Validate the member PKCE flow from a browser separate from the server host: approval, denial, expiry and poll interval.
- [ ] Verify the pi-cursor auth and usage modules run under Bun without the pi runtime. If not, port them.
- [ ] Validate the primary RPC and the REST fallback with a real token. Pin one primary. Record the pool names each returns.
- [ ] Test token refresh and the `reconnect_required` path when refresh fails. Keep the old snapshot visible.
- [ ] Add synthetic fixtures for success, partial response and schema drift on each pinned endpoint. Return `invalid_response` on drift.
- [ ] Keep included, on-demand, spend cap, and invoice amounts as distinct metric types.
- [ ] Test a member and an administrator account, each as its own connection with its own credential.
- [ ] Disconnect deletes the credential row and records `local_only` unless a revocation endpoint is validated.

## Sources

1. [S1: Cursor Agent authentication](https://cursor.com/docs/cli/reference/authentication) - browser and API-key authentication. Reviewed 2026-10-01; the former `docs.cursor.com` path now redirects.
2. [S2: Cursor Admin API](https://cursor.com/docs/account/teams/admin-api) - key ownership, team usage/spending access, rate limits and query ranges. Reviewed 2026-10-01; the former `docs.cursor.com` path now redirects.
3. [S3: Cursor team roles](https://cursor.com/docs/account/teams/members) - member and administrator permissions. Reviewed 2026-10-01.
4. [S4: Cursor usage and limits](https://prod.cursor.com/help/models-and-usage/usage-limits) - usage pools, reset cycle, and on-demand behavior. Reviewed 2026-10-01.
5. [S5: Cursor usage-based charges](https://prod.cursor.com/help/account-and-billing/overages) - included versus on-demand usage. Reviewed 2026-10-01.
6. [S6: pi-cursor community implementation, MIT TypeScript](https://github.com/Rahularya01/pi-cursor) - private sign-in, polling, refresh and usage package. Reviewed 2026-10-01.
7. [S7: ai-usagebar vendor endpoints, community](https://github.com/akitaonrails/ai-usagebar/blob/main/docs/vendor-endpoints.md) - `usage-summary` endpoint reference. Reviewed 2026-10-01.
8. [S8: OpenUsage Cursor provider notes, community](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md) - member RPC, REST fallbacks, balance and export routes. Reviewed 2026-10-01; Grok Bot section reviewed 2026-10-04.
9. [S9: OpenUsage Cursor mapper, community, MIT Swift](https://github.com/robinebers/openusage/blob/ae49de04a2b7fc1b3cc334fcc1009276c46d82ad/Sources/OpenUsage/Providers/Cursor/CursorUsageMapper.swift) - `mapGrokBotUsage`: the Grok Bot fields and eligibility checks. Reviewed 2026-10-04.
