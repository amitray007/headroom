# Codex

> Reviewed: 2026-10-01. This page is a connector reference, not a statement of a user's plan entitlement.

## Scope and recommendation

Sign in through the official CLI, as ADR 0001 decides. The primary route is `cli_login`: a shared CLI login runner starts `codex login --device-auth` (documented beta [S2]) with `CODEX_HOME` set to a per-attempt directory and an allowlisted environment. The CLI prints a verification URL and a user code. Headroom shows them, waits for the CLI to write `$CODEX_HOME/auth.json`, reads that file once, encrypts it and deletes the directory. The CLI documents the file: "Codex caches login details locally in a plaintext file at ~/.codex/auth.json" [S2]. The CLI never runs again for that connection.

The second route is `import`: the user pastes an existing `auth.json` through the `paste_file` next step. The fallback is the direct device-code client ported from CLIProxyAPI. Refresh and collection are direct HTTP against the stored token. Refresh goes to the ChatGPT OAuth token endpoint with the stored refresh token. Collection reads `GET https://chatgpt.com/backend-api/wham/usage`, the endpoint the official CLI calls. Codex is the first connector.

Policy posture: OpenAI says app-server authentication "has never been permitted for commercial or hosted services" [S1]. Headroom reuses the CLI credentials file and the ChatGPT OAuth client. Headroom is personal self-hosted software that stores only the owner's own credentials on the owner's server. It does not proxy inference, hosts no one else's account and must not be offered as a hosted service. The owner should check OpenAI's terms before enabling this provider. The connector ships behind a per-provider enable flag and every metric is labelled `private` or `official`.

Use the same design for Go, Plus, Pro, Business, Enterprise and future ChatGPT plans. Plan type is returned data, not an entitlement table that Headroom should hardcode.

## Evidence status

| Claim | Status | Basis |
| --- | --- | --- |
| Device-code login exists for the official CLI as `codex login --device-auth` (beta) | documented | [S2] |
| Headless `codex login --device-auth` v0.159.3 needs no TTY, honours `CODEX_HOME`, prints the verification URL and a one-time code that expires in fifteen minutes, and polls until killed | validated | Run by this project on 2026-10-01 with an isolated home and stdin closed; no account was signed in |
| The CLI caches login details in a plaintext `auth.json` under `$CODEX_HOME` (default `~/.codex`) | documented | [S2] |
| OpenUsage reads the same `auth.json`, respects `$CODEX_HOME` and refreshes the token itself | source-inspected | OpenUsage Codex provider doc [S6] |
| Refresh posts the stored refresh token to the ChatGPT OAuth token endpoint | source-inspected | CLIProxyAPI [S4] |
| Headless `codex login --device-auth` on Linux writes `auth.json` without a keyring | unvalidated | Needs the Linux proof in the checklist |
| Fallback direct device flow: request a device user code, poll the device token endpoint at the returned interval | source-inspected | CLIProxyAPI `sdk/auth/codex_device.go` [S4] |
| Identity (email, account id, plan) comes from the id-token JWT claims | source-inspected | CLIProxyAPI `internal/auth/codex/jwt_parser.go` [S4] |
| `GET https://chatgpt.com/backend-api/wham/usage` returns quota, credits and plan | source-inspected | CLIProxyAPI `internal/runtime/executor/helps/codex_quota.go` [S4]; ai-usagebar [S5] |
| Usage fields: `plan_type`, `rate_limits` (primary and secondary windows), `additional_rate_limits`, `code_review_rate_limits`, `credits`, `metered_limit_name` | source-inspected | CLIProxyAPI `codex_quota.go` [S4] |
| A reset-credit inventory read route exists under `wham/rate-limit-reset-credits` | validated | Observed by this project on 2026-10-01 with a Headroom CLI-login credential: 200 with `credits[]` carrying a status and expiry per credit; the count matched `rate_limit_reset_credits.available_count` in the usage body |
| A direct HTTP route to consume a reset credit: `POST /wham/rate-limit-reset-credits/consume` | source-inspected | Found in the pinned CLI 0.159.3 next to the read route on 2026-10-02, with the serde names `credit_type` (`usage_limit`, `credits`) and a response naming `windows_reset`; the app-server call that fronts it takes creditId, creditType and idempotencyKey. Body field names are inferred and unvalidated until a consume is observed from the dashboard |
| App-server exposes rate limits, reset-credit inventory, redemption and token history | documented | [S1] |
| OpenAI's terms on using the ChatGPT OAuth client outside OpenAI's apps | documented | [S1] says app-server authentication "has never been permitted for commercial or hosted services". Headroom is not a hosted service; the owner should check the terms |
| A server-hosted device flow works for every workspace | unvalidated | Device-code access can be restricted by account or workspace policy |
| A prior account returned a weekly quota, credits, reset inventory and daily buckets | prior observation | Sanitized earlier research; not a current test |

## Metrics

Every metric below comes from direct HTTP collection unless noted. A completed login does not prove quota access.

| Metric | Availability | Unit and source | Notes |
| --- | --- | --- | --- |
| Session or short window | `available` when returned | `rate_limits` primary window: used percent, window minutes, `resets_at` | `private`. Do not call this an hourly limit unless the window minutes say so. |
| Weekly or long window | `available` when returned | `rate_limits` secondary window | `private`. Interpret the labels and window length the service returns. |
| Model-specific limit | `available` when returned | `additional_rate_limits` keyed by limit name | `private`. Bucket names are provider data. Do not add them to the overall window. |
| Code review limit | `available` when returned | `code_review_rate_limits` | `private`. Separate bucket. |
| Monthly limit | `unsupported` | Not a documented account field | Store only if a returned bucket expresses it. |
| Credits | `available` when returned | `credits`: `has_credits`, `unlimited`, `balance` | `private`. Provider credit unit, not dollars. `unlimited` is an explicit flag, not a number. |
| Next reset | `available` when returned | `resets_at`, Unix seconds | `private`. Retain the raw timestamp. |
| Banked reset count | `unknown` | `…/wham/rate-limit-reset-credits` read route | `private`. Validated 2026-10-01 (see the evidence table above). The app-server count is `official` but not the primary route. |
| Reset redemption | `available` behind the "Allow Account Actions" setting | `POST …/rate-limit-reset-credits/consume` with the action row id as idempotency key | `private`. Explicit owner action with a confirmation naming the credit and its expiry. The owner can also set an auto-reset rule (ADR 0003) that calls the same route when a watched `rate_limit.*` window is used up, behind the same setting; it is the only background caller. Unvalidated until the owner runs the first one. |
| Usage history | `unknown` on the direct route | App-server `dailyUsageBuckets` | `official` by fallback only. `null` means unavailable, not zero. |
| Admin versus non-admin | Provider-enforced | Account or workspace policy | Do not infer privileges from a plan name. |

## Connect workflow

1. Create an attempt (`created`) bound to the owner, provider and a new connection. Create the attempt directory.
2. The runner starts `codex login --device-auth` with `CODEX_HOME` set to that directory. Move to `awaiting_user`.
3. Parse only the verification URL, user code and expiry from the output. Return the next step `device_code`. The user signs in and completes MFA on OpenAI's site, from any device.
4. Wait for the CLI to exit. Stop on exit success, denial, timeout or expiry (`expired`). Support cancel (`cancelled`), which kills the process.
5. On success, read `auth.json` once, read identity from the id-token claims, encrypt the file and move to `validating`.
6. Delete the attempt directory in every terminal state.
7. Run one read-only `GET /backend-api/wham/usage` with the stored access token. Do not make a model request.
8. Store the encrypted credentials, capabilities and first snapshot. Mark the attempt `succeeded` and the connection `ready`, or `partial` when identity works but usage fails.
9. Refresh the access token in the connector before collection when it nears expiry, or after a 401. Persist a rotated refresh token before using the result. A definitive refresh failure sets `reconnect_required`.

### Credential import

The user pastes the contents of an existing `auth.json` through the next step `paste_file` (`awaiting_input`). Headroom checks the shape, reads identity from the id-token claims, encrypts the file and never writes the plaintext back. A wrong-shape file ends the attempt as `failed` with a sanitized reason. The connection records the auth method `import`. Continue at step 7 above.

### Direct client fallback

If the CLI route fails validation, use the direct device-code client from CLIProxyAPI [S4]. Request a device user code from the ChatGPT device endpoint and store the polling credential in the encrypted attempt state. Move to `awaiting_user` and return `device_code`. Poll the device token endpoint at the returned interval until approval, denial or expiry. Exchange the approval for tokens, read identity from the id-token claims and continue at step 7. The auth method is `device_code`. This route embeds the ChatGPT OAuth client, so the CLI route stays primary.

### App-server fallback

A further fallback runs the official Codex app-server per connection with its own credential store. Start `account/login/start` with `type: "chatgptDeviceCode"`, wait for `account/login/completed`, then read `account/read`, `account/rateLimits/read` and `account/usage/read`. Do not call `account/logout` at the end of a connect. It needs one process and credential directory per account and a pinned protocol version. It does not remove the OpenAI permission limit.

## APIs and tools

### Collection and refresh

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| CLI login | `codex login --device-auth` with `CODEX_HOME` set | `official` | Sign-in only, in the runner. |
| Credentials file | `$CODEX_HOME/auth.json` | `official` | Read once, encrypt, delete. |
| Token refresh | ChatGPT OAuth token endpoint with the stored refresh token | `private` | Refresh in the connector. |
| Usage | `GET https://chatgpt.com/backend-api/wham/usage` | `private` | Quota windows, credits, plan. |
| Reset-credit inventory | `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` (per ai-usagebar) | `private` | Read only. Validated 2026-10-01. |

### Direct client fallback

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| Device user code request | ChatGPT device authorization endpoint, per CLIProxyAPI `codex_device.go` | `private` | Begin sign-in. Exact URL pinned during validation. |
| Device token poll | ChatGPT device token endpoint, per CLIProxyAPI `codex_device.go` | `private` | Poll at the returned interval. |

The direct HTTP consume route is implemented as the `consume_reset_credit` action and stays unvalidated until the owner triggers it from the dashboard; agents never run it with live credentials.

### App-server reference

| Interface | Use in Headroom | Limits |
| --- | --- | --- |
| `account/login/start` | Begin device-code sign-in | Requires a supported account and device-code permission. |
| `account/login/completed` | Detect success or failure | Notification, not a durable snapshot. |
| `account/rateLimits/read` | Fetch current quota, resets, optional credits | Fields are optional and can change. |
| `account/rateLimits/updated` | Improve freshness while app-server is alive | Do not rely on it as the only refresh path. |
| `account/usage/read` | Fetch token summary and daily buckets | Requires Codex-services-backed authentication. |
| `account/rateLimitResetCredit/consume` | Redeem a selected earned reset | Requires a non-empty idempotency key. |
| `account/logout` | Disconnect only | Never use to end a successful connect worker. |

For a reset, create an action row before the call. Reuse its UUID as the idempotency key on retry. Treat `alreadyRedeemed` as success, then fetch limits again. Surface `nothingToReset` and `noCredit` as provider outcomes, not generic errors.

### Refresh and reconnect

Refresh is `POST https://auth.openai.com/oauth/token` with `grant_type=refresh_token` and the public client id `app_EMoamEEZ73f0CkXaXp7hrann` that the Codex CLI uses; both constants are in CLIProxyAPI `internal/auth/codex/openai_auth.go` [S4] and the id is in the official CLI. Expiry comes from the access token's JWT `exp` claim. `invalid_grant` is definitive and sets `reconnect_required` with `refresh_rejected`. A 401 from `wham/usage` gets one refresh and retry, then is definitive. Reconnect runs the CLI login again or accepts a pasted `auth.json`; the identity must match the stored account id. Whether a later `codex login` elsewhere invalidates this refresh token is a validation item.

## Available packages and limits

| Package or tool | Value | Limit |
| --- | --- | --- |
| CLIProxyAPI (MIT, written in Go) | Reference for the fallback device flow, JWT parsing and quota fields; port the logic to TypeScript with attribution | Tracks private endpoints; pin the reviewed version. |
| Official Codex CLI | Login only, in the runner | Pin the version; headless Linux behaviour needs proof. |
| OpenUsage | Reference for `auth.json` reading and token refresh | Private endpoint risk. |
| Official Codex app-server | Further fallback runtime and structured account protocol | Track its protocol version. |
| `codex-acp` | Agent interoperability and session usage | ACP does not standardize account quotas or reset credits. |
| `ai-usagebar` | Read-only reference for endpoints and normalization | Not a credential runtime. |
| `@oh-my-pi/pi-ai` | Reference for quota and reset shapes | Uses provider behavior that must be validated independently. |

## Prior observations

Earlier account research observed a response with a weekly-style quota, workspace-credit information, a nonzero earned-reset inventory and daily token buckets. This confirms that the documented fields can be populated. It does not prove the same fields, bucket names, plan labels or reset inventory for another account.

## Cannot promise

- Headless CLI login works on every server image. The Linux proof decides.
- Device-code login can be disabled by a personal security setting or workspace admin.
- OpenAI's terms cover reuse of the CLI credentials or the ChatGPT OAuth client for the owner's use. Headroom's posture is personal self-hosted use only; the owner checks OpenAI's terms.
- The private usage endpoint keeps its path, headers or fields. A changed shape yields `invalid_response` for that metric.
- A refresh token stays valid. OpenAI can revoke it; the connection then shows `reconnect_required`.
- Every plan exposes credits, daily history, all bucket details or reset-credit rows.
- A reset can be redeemed only when the provider reports an eligible window and credit.
- Headroom cannot determine a plan's marketing allowance from a generic quota response.

## Implementation and validation checklist

- [ ] Gate the connector behind a per-provider enable flag and label every metric `official` or `private`.
- [ ] Prove headless `codex login --device-auth` on Linux writes `auth.json` without a keyring.
- [ ] Prove the runner deletes the attempt directory in every terminal state.
- [ ] Prove import rejects a wrong-shape file.
- [ ] Prove device login from a browser on a different machine than the server.
- [ ] Prove token refresh, rotated refresh-token persistence and repeat collection after process restart.
- [ ] Prove revocation handling: a revoked token sets `reconnect_required` and keeps the old snapshot with its original time.
- [ ] Capture synthetic fixtures for success, partial response and schema drift of `wham/usage`; bump the connector version on any parser change.
- [ ] Test two Codex connections without credential or snapshot leakage.
- [ ] Preserve `null`, absent and empty-list distinctions in the normalized schema.
- [ ] Validate the reset-credit inventory read route before showing a count.
- [x] Redemption is built behind the "Allow Account Actions" setting (D23): a confirmation screen names the credit, and quotas refresh after the action. The route stays unvalidated until the owner runs one.
- [ ] Add capability flags rather than treating unavailable fields as failures.

## Sources

1. [S1: Codex App Server, official](https://learn.chatgpt.com/docs/app-server) - login, rate limits, usage history, reset-credit protocol and the hosted-service restriction. Reviewed 2026-10-01.
2. [S2: Codex authentication, official](https://learn.chatgpt.com/docs/auth) - `codex login --device-auth` (beta) and the plaintext `auth.json` cache. Reviewed 2026-10-01.
3. [S3: Codex ACP reference](https://github.com/agentclientprotocol/codex-acp) - ACP bridge scope. Reviewed 2026-10-01.
4. [S4: CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) - MIT, written in Go, v8.0.8 released 2026-10-01. Files read: `sdk/auth/codex_device.go`, `internal/auth/codex/jwt_parser.go`, `internal/runtime/executor/helps/codex_quota.go`. Reviewed 2026-10-01.
5. [S5: ai-usagebar endpoint reference](https://github.com/akitaonrails/ai-usagebar/blob/main/docs/vendor-endpoints.md) - `wham/usage` and the reset-credit read route. Reviewed 2026-10-01.
6. [S6: OpenUsage Codex provider](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md) - `auth.json` location, `$CODEX_HOME` and token refresh. Reviewed 2026-10-01.
