# Grok

Reviewed: 2026-10-01. This record concerns an xAI/Grok account connection. It does not claim that one login exposes every Grok, X, enterprise or API product entitlement.

## Scope and recommendation

Sign in through the official Grok CLI, as ADR 0001 decides. The primary route is `cli_login`: the shared CLI login runner starts `grok login --device-auth` [S1] with the CLI's home directory variable pointing at a per-attempt directory and an allowlisted environment. The CLI prints a verification URL and a code. Headroom shows them, waits for the CLI to write `~/.grok/auth.json` under that directory, reads it once, encrypts it and deletes the directory. OpenUsage reads the same file [S3]. It references `GROK_HOME` for sessions. Confirm the variable that controls the auth file at implementation.

The second route is `import`: the user pastes an existing `auth.json` through the `paste_file` next step. The fallback is the direct xAI device client from CLIProxyAPI. Refresh and collection are direct HTTP against the stored token and never go through the CLI. Collection reads the Grok CLI chat proxy billing route taken from OpenUsage.

Policy posture: xAI publishes no terms for the private billing interface. Headroom is personal self-hosted software that stores only the owner's own credentials, routes no inference and must not be offered as a hosted service. The collector ships behind a per-provider enable flag. All consumer routes are `private` and source-inspected, not validated against a live account.

API billing is a separate connection with the next step `api_key`, not part of the consumer login. Never collect xAI passwords, MFA codes or cookies.

## Evidence status

| Claim | Status | Basis |
| --- | --- | --- |
| Headless `grok login --device-auth` (CLI 1.0.46) needs no TTY, honours `$GROK_HOME`, prints `https://accounts.x.ai/oauth2/device?user_code=<code>` and the code on stderr, and polls until killed | validated | Run by this project on 2026-10-01 with an isolated home; no account was signed in |
| The official installer places the binary with `GROK_BIN_DIR` and downloads under `$HOME/.grok/downloads` | validated | Installer run on 2026-10-01 into a temporary prefix |
| `grok login --device-auth` supports headless and remote environments | documented | Grok CLI documentation [S1] |
| It prints a URL and code, and polls for confirmation | documented | Device Code Flow [S1] |
| `grok login` replaces a cached session; `grok logout` clears it | documented | Re-authentication [S1] |
| CLI supports an API-key fallback for xAI API use | documented | API Key section [S1] |
| CLI cached credentials auto-refresh in documented cases | documented | Refresh section [S1] |
| The CLI writes `~/.grok/auth.json`, which OpenUsage reads | source-inspected | OpenUsage Grok provider doc [S3] |
| The variable that relocates the auth file is `GROK_HOME` | validated | Headless `grok login --device-auth` (CLI 1.0.46) wrote `auth.json` under `$GROK_HOME` on 2026-10-01, and Headroom's login completed through it the same day |
| `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` returns the weekly shared pool usage percent with reset and the pay-as-you-go cap | source-inspected | OpenUsage doc and `GrokUsageClient.swift` [S3] |
| `GET https://cli-chat-proxy.grok.com/v1/settings` returns the plan tier | source-inspected | OpenUsage `GrokUsageClient.swift` [S3] |
| Both routes need `Authorization: Bearer <access token>` and `X-XAI-Token-Auth: xai-grok-cli` | source-inspected | OpenUsage `GrokUsageClient.swift` [S3] |
| Refresh posts `grant_type=refresh_token` to `https://auth.x.ai/oauth2/token` with the OIDC client id stored in the auth file | source-inspected | OpenUsage [S3]; default client id is in its source |
| Accounts not yet on unified weekly billing have no weekly pool | source-inspected | OpenUsage [S3] |
| Team or business logins get HTTP 412 "No personal team" from the billing route | source-inspected | OpenUsage [S3] |
| Legacy monthly credits meter exists for older accounts | source-inspected | OpenUsage marks it legacy [S3] |
| Direct device flow (`StartDeviceFlow`, `WaitForAuthorization`) | source-inspected | CLIProxyAPI `sdk/auth/xai.go`, `internal/auth/xai` [S4] |
| SuperGrok collector with `GetRemainingResets` parsing | source-inspected | ai-usagebar [S2]; secondary reference, private contract |
| `GET https://management-api.x.ai/v1/billing/teams/{team}/prepaid/balance` returns the prepaid balance with a management API key | unvalidated | Official management API, documented by reference. Less needed now: the CLI billing body itself carries `prepaidBalance.val` (validated 2026-10-01) |
| Headless `grok login --device-auth` on Linux writes `auth.json` without a keyring | unvalidated | Needs the Linux proof in the checklist |
| Billing routes work for every Grok plan | validated for one plan | `GET /v1/billing?format=credits` answered 200 on 2026-10-01 for Amit's individual plan with `config.currentPeriod` (weekly), `creditUsagePercent`, `onDemandCap.val`, `onDemandUsed.val`, `prepaidBalance.val`, `productUsage[].{product, usagePercent}` and `isUnifiedBillingUser`; `/v1/settings` returned `subscription_tier_display`. Team logins (412) remain unobserved |

Earlier research reviewed community collectors and a prior account observation. That is not a fresh account check. No quota percentage, plan name, account id or credential is present here.

## Metrics

| Dashboard field | Availability | Source and interpretation | Notes and limit |
| --- | --- | --- | --- |
| Connection state | Yes | Login completes | `private`. Authentication is not quota access. |
| Weekly shared pool percent and reset | `available` when returned | `v1/billing?format=credits` | `private`. Without unified weekly billing the pool is absent, so the value is `unknown`. |
| Pay-as-you-go cap | `available` when returned | `v1/billing?format=credits` | `private`. A status value, kept separate from the pool percent and from any balance. |
| Plan tier | `available` when returned | `v1/settings` | `private`. Provider label; do not map it to an entitlement table. |
| Legacy monthly credits meter | `unsupported` | Legacy per OpenUsage | `private`. Do not build on it. |
| Team or business billing | `unsupported` | HTTP 412 "No personal team" | The connection is `partial` with a capability reason. This is not a failure. |
| API prepaid balance | `unknown` until validated | Management API prepaid balance, separate `api_key` connection | `official`. Currency balance in its own unit; differs from the consumer plan. |
| Model-specific allowance | `unknown` | No verified contract | Do not derive a generic quota. |
| Banked reset count | `unknown` until validated | `GetRemainingResets` path in the ai-usagebar collector [S2] | `private`. Secondary reference only. |
| Reset redemption | `unsupported` | Read support does not imply action support | No reset action in v1. |
| Usage history | Yes after collection | Headroom snapshots | Only validated metrics. |
| Account identity | Candidate | Token claims or identity read after login | Verify with a non-sensitive read. |

## Connect workflow

1. Create an attempt (`created`) bound to the owner, provider and a new connection. Create the attempt directory.
2. The runner starts `grok login --device-auth` with the CLI home variable pointing at that directory. Move to `awaiting_user`.
3. Parse only the verification URL, code and expiry. Return the next step `device_code`. The user approves on xAI in any browser.
4. Wait for the CLI to exit. Stop on success, denial, timeout or expiry (`expired`). Support cancel (`cancelled`), which kills the process. Never call `grok logout` at the end of a connect [S1].
5. On success, read `auth.json` once, encrypt it and move to `validating`. Delete the attempt directory in every terminal state.
6. Read the plan tier from `v1/settings` and run one read-only `v1/billing?format=credits`. Do not make a model request.
7. Mark the attempt `succeeded`. Mark the connection `ready`, or `partial` when login works but billing returns no personal data (HTTP 412 or no weekly pool). State the capability reason.
8. Refresh before collection when the token nears expiry, or after a 401, at the xAI token endpoint. Persist a rotated refresh token first. A definitive failure sets `reconnect_required`.

### Credential import

The user pastes an existing `auth.json` through the next step `paste_file` (`awaiting_input`). Headroom checks the shape, encrypts the file and never writes the plaintext back. A wrong-shape file ends the attempt as `failed`. The auth method is `import`. Continue at step 6.

### Direct client fallback

If the CLI route fails validation, use the direct xAI device client from CLIProxyAPI [S4]. Start the device flow and store the polling credential in the encrypted attempt state. Return the next step `device_code` (`awaiting_user`). Poll until approval, denial or expiry. On approval, store the tokens, move to `validating` and continue at step 6. The auth method is `device_code`.

### API billing

Offer a separate connection with the next step `api_key`. The user pastes a management API key. Headroom validates it, resolves the team and uses `select_account` when several teams exist. Never collect xAI passwords, MFA codes or cookies.

## APIs and tools

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| CLI login | `grok login --device-auth` | `official` | Sign-in only, in the runner. |
| Credentials file | `~/.grok/auth.json` under the attempt directory | `official` | Read once, encrypt, delete. |
| Token refresh | `POST https://auth.x.ai/oauth2/token` with `grant_type=refresh_token` and the client id from the auth file | `private` | Refresh in the connector. |
| Weekly pool and cap | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` | `private` | Weekly pool percent, reset, pay-as-you-go cap. |
| Plan tier | `GET https://cli-chat-proxy.grok.com/v1/settings` | `private` | Plan label. |
| API prepaid balance | `GET https://management-api.x.ai/v1/billing/teams/{team}/prepaid/balance` with a management API key | `official` | Separate `api_key` connection. Unvalidated. |
| Fallback device flow | xAI device authorization and token endpoints, per CLIProxyAPI `internal/auth/xai` | `private` | Direct client fallback. Exact URLs pinned during validation. |

Send `Authorization: Bearer <access token>` and `X-XAI-Token-Auth: xai-grok-cli` on both `cli-chat-proxy.grok.com` routes. The default OIDC client id is `b1a00492-073a-47ea-816f-4c329264a828` in OpenUsage source. Prefer the id stored in the auth file.

The ai-usagebar SuperGrok collector [S2] stays a secondary reference. It is no longer the quota source. The CLI also supports an `XAI_API_KEY` fallback for API and CI usage [S1]. That is not consumer plan monitoring: API billing and a Grok consumer plan are separate entitlements. Do not copy opaque browser cookies into Headroom's database.

### Refresh and reconnect

Refresh is `POST https://auth.x.ai/oauth2/token` with `grant_type=refresh_token` and the OIDC client id stored in the auth file, defaulting to `b1a00492-073a-47ea-816f-4c329264a828` in OpenUsage source [S2]. Expiry comes from the access token's JWT `exp` claim. A 401 or 403 from the billing route gets one refresh and retry, then is definitive. A 412 is a capability result (`partial`), never a reconnect. The official docs say `grok login` replaces the cached session [S1], so a later login elsewhere is expected to make this token definitive-fail; validate and document the behaviour. Reconnect runs the CLI login again or accepts a pasted `auth.json`.

## Available packages and limits

| Tool | Value | Limit |
| --- | --- | --- |
| Official Grok CLI | Login only, in the runner | Does not document a consumer quota API; pin the version. |
| OpenUsage | Billing and settings routes, headers, refresh | Private endpoint risk. |
| CLIProxyAPI (MIT, written in Go) | Reference for the fallback xAI device flow; port the logic to TypeScript | Tracks private endpoints; pin the reviewed version. |
| ai-usagebar | Secondary collector and endpoint reference | Not a credential runtime. |
| ACP | Can standardize the agent login process | Does not standardize subscription quotas. |

## Prior observations

Earlier research reported a fresh consumer weekly quota from an OpenUsage collector, before the billing route was identified. This supports a private-data candidate for that account only. It does not establish coverage for X, all Grok plans or xAI API billing.

## Cannot promise

- That a Grok login represents a consumer, X, API or enterprise plan.
- Weekly pool data for every plan, or a stable response shape. Team and business logins return HTTP 412 and show `partial`. A changed shape yields `invalid_response` for that metric.
- Quota reset times, credit balances or banked reset inventory.
- Reset redemption or plan-management actions.
- Silent refresh forever. xAI can revoke a token; the connection then shows `reconnect_required`.
- That the management API key route works without a team and billing scope.

## Implementation and validation checklist

- [ ] Gate the consumer connector behind a per-provider enable flag and label every metric `official` or `private`.
- [ ] Prove headless `grok login --device-auth` on Linux writes `auth.json` without a keyring, and confirm the home variable for auth.
- [ ] Prove the runner deletes the attempt directory in every terminal state.
- [ ] Prove import rejects a wrong-shape file.
- [ ] Prove the device code from a browser on a different machine than the server, using a consenting test account.
- [ ] Prove token refresh, rotated refresh-token persistence and repeat validation after restart.
- [ ] Prove revocation handling: `reconnect_required` with the old snapshot kept.
- [ ] Capture synthetic fixtures for success, partial response and schema drift of `v1/billing` and `v1/settings`, including the 412 response; bump the connector version on any parser change.
- [ ] Define plan identity and product surface before quota collection.
- [ ] Validate one weekly pool percent and reset against the provider UI.
- [ ] Validate the management API balance route with a test key and a synthetic fixture.
- [ ] Use `partial` for login without validated limits, including team logins.
- [ ] Add disconnect that deletes only this connection's credentials.

## Sources

- [S1] xAI, [Grok CLI authentication guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md), reviewed 2026-10-01.
- [S2] ai-usagebar, [provider endpoints and contract notes](https://github.com/akitaonrails/ai-usagebar/blob/main/docs/vendor-endpoints.md), reviewed 2026-10-01.
- [S3] OpenUsage, [Grok provider doc](https://github.com/robinebers/openusage/blob/main/docs/providers/grok.md) and `Sources/OpenUsage/Providers/Grok/GrokUsageClient.swift` in [the repository](https://github.com/robinebers/openusage), reviewed 2026-10-01. Recheck the chosen revision before adoption.
- [S4] [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), MIT, written in Go, v8.0.8 released 2026-10-01. Files read: `sdk/auth/xai.go`, `internal/auth/xai`. Reviewed 2026-10-01.
