# Antigravity

Reviewed: 2026-10-01. This record covers Google Antigravity account sign-in and quota concepts. It excludes Zed by product decision.

## Scope and recommendation

Keep the direct Google client as the primary route, as ADR 0001 decides. Headroom implements the Google OAuth sign-in in TypeScript with the Antigravity client constants, finishes the code exchange itself, stores encrypted tokens and refreshes them in-process. The official `agy` CLI is not primary because it stores tokens in the Linux Secret Service keyring, which a headless container lacks. It is the documented fallback.

CLIProxyAPI's Antigravity code is sign-in only (client id, scopes, token endpoint). It does not read quota, so the quota route comes from OpenUsage [S6]. Headroom reads quota from `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`.

Policy posture: this is a private interface and Google publishes no terms for it. Headroom is personal self-hosted software that stores only the owner's own credentials, routes no inference and must not be offered as a hosted service. The connector ships behind a per-provider enable flag. Never accept a Google password or MFA code.

The credits balance stays `unknown`. The quota read is unvalidated.

## Evidence status

| Claim | Status | Basis |
| --- | --- | --- |
| Google OAuth with the Antigravity client id and scopes, redirect `http://localhost:<port>/oauth-callback`, then code exchange | source-inspected | CLIProxyAPI `internal/auth/antigravity/auth.go`, `constants.go`, `sdk/auth/antigravity.go` [S4] |
| Constants: auth endpoint `https://accounts.google.com/o/oauth2/v2/auth`, token endpoint `https://oauth2.googleapis.com/token`, user info `https://www.googleapis.com/oauth2/v2/userinfo`, redirect `http://localhost:51121/oauth-callback` | source-inspected | CLIProxyAPI `internal/auth/antigravity/constants.go` [S4] |
| Scopes: cloud-platform, userinfo.email, userinfo.profile, cclog, experimentsandconfigs | source-inspected | CLIProxyAPI `constants.go` [S4] |
| API hosts `https://cloudcode-pa.googleapis.com` and `https://daily-cloudcode-pa.googleapis.com` | source-inspected | CLIProxyAPI `constants.go` [S4] |
| The client is a public installed-app client; its id and secret are constants in CLIProxyAPI source | source-inspected | CLIProxyAPI `constants.go` [S4]; this page does not reproduce them |
| CLIProxyAPI reads no quota for Antigravity | source-inspected | CLIProxyAPI [S4] |
| Helpers `BuildAntigravityAuthURL`, `ExchangeAntigravityCode`, `FetchAntigravityProjectID`, `FetchAntigravityUserInfo` | source-inspected | CLIProxyAPI `sdk/auth/antigravity.go` [S4] |
| Identity email comes from user info; a project id lookup is required for quota calls | source-inspected | CLIProxyAPI [S4] |
| `v1internal:retrieveUserQuotaSummary` is the only endpoint reporting the merged Gemini and Claude/GPT pools with both five-hour and weekly windows | source-inspected | OpenUsage Antigravity provider doc [S6]; ai-usagebar [S5] |
| Legacy fallbacks `fetchAvailableModels` and `retrieveUserQuota` know only five-hour windows per model; OpenUsage merges them by worst remaining fraction | source-inspected | OpenUsage [S6] |
| Plan name comes from `userTier` | source-inspected | OpenUsage [S6] |
| The quota summary works for Headroom's token and account | unvalidated | Private interface; not tested |
| Remote CLI prints a secure authorization URL and the browser shows a code to paste | documented | Remote SSH flow [S1] |
| Local CLI uses a native secure keyring | documented | Authentication section [S1] |
| Gemini API-key mode does not establish an account session | documented | API-key section [S1] |
| CLI `/usage` and `/credits` commands exist | documented | CLI reference [S2] |
| Status-line JSON exposes model and bucket quota (`remaining_fraction`, `reset_time`, optional `reset_in_seconds`) | documented | [S3] |
| Credit balance is available | unvalidated | A prior attempt did not establish it |
| ACP exposes an account-quota endpoint | documented (false) | ACP usage is session telemetry, not billing |

Earlier research observed model-group usage output and tried a credits command. It did not establish a supported balance field. Exact percentages, account identity and private output are excluded here.

## Metrics

| Dashboard field | Availability | Source and interpretation | Notes and limit |
| --- | --- | --- | --- |
| Plan name | `available` when returned | `userTier` | `private`. Provider label; do not map it to an allowance. |
| Per-model five-hour window | `available` when returned | Legacy `fetchAvailableModels` and `retrieveUserQuota`, merged by worst remaining fraction | `private`. Fallback only; no weekly window. |
| Connection state | Yes | Direct sign-in | `private`. Login does not prove quota read. |
| Gemini pool quota | `available` when returned | `retrieveUserQuotaSummary`, five-hour and weekly windows | `private`. Preserve each window. |
| Claude/GPT pool quota | `available` when returned | `retrieveUserQuotaSummary`, five-hour and weekly windows | `private`. Separate pool; do not add to Gemini. |
| Pool reset time | `available` when returned | Reset fields in the summary | `private`. Preserve per-bucket window. |
| Session or context usage | Candidate through ACP | ACP session usage | `official`. Not subscription allowance. |
| Credits or wallet balance | `unknown` | No validated response | `private`. Do not display zero. |
| Monthly allowance | `unknown` | No verified contract | Do not infer from plan name. |
| Banked reset count | `unknown` | No verified contract | No reset action. |
| Usage history | Yes after collection | Headroom snapshots | Record source and freshness. |
| Account identity | `available` | Email from user info | `private`. Do not expose it outside the owner's UI. |
| Admin or organization limits | `unknown` | No verified contract | Separate from the individual account. |

## Connect workflow

1. Create an attempt (`created`) with a PKCE verifier and state kept server-side.
2. Build the authorization URL at the Google auth endpoint with `BuildAntigravityAuthURL`. Return the next step `paste_redirect` (`awaiting_input`).
3. The user signs in with Google. The browser redirects to `http://localhost:<port>/oauth-callback`, which a remote server cannot receive. The user pastes the redirected URL into Headroom.
4. Verify state, exchange the code (`ExchangeAntigravityCode` shape) and move to `validating`.
5. Read user info for the email and look up the project id (`FetchAntigravityUserInfo`, `FetchAntigravityProjectID` shapes).
6. Run one read-only `POST …:retrieveUserQuotaSummary`. Do not make a model request.
7. Encrypt and store tokens, capabilities and the first snapshot. Mark the attempt `succeeded` and the connection `ready`, or `partial` when quota access fails.
8. Refresh at the Google token endpoint before collection when the token nears expiry, or after a 401. Persist a rotated refresh token first. A definitive failure sets `reconnect_required`.
9. When `retrieveUserQuotaSummary` fails or is absent, fall back to `fetchAvailableModels` and `retrieveUserQuota` and keep only five-hour windows. Record the missing weekly window as `unknown`.

### Official CLI fallback

The fallback is the official `agy` remote URL and code flow: an isolated `agy` login prints an authorization URL, the user pastes the displayed code, and Headroom reads the status-line JSON [S1, S3]. It is not primary because the CLI keeps its credentials in the Linux Secret Service (D-Bus) keyring that a headless container lacks, the status line exists only inside an interactive session, and each connection needs its own home directory. The status-line JSON stays a shape reference. It also carries `email`, `cwd` and `transcript_path`, so Headroom must never store the whole payload.

## APIs and tools

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| Authorization | `https://accounts.google.com/o/oauth2/v2/auth` with the Antigravity client id, the five scopes and redirect `http://localhost:51121/oauth-callback` | `private` | Begin sign-in. |
| Token exchange and refresh | `POST https://oauth2.googleapis.com/token` | `private` | Exchange the code; refresh in the connector. |
| User info | `GET https://www.googleapis.com/oauth2/v2/userinfo` | `private` | Email for identity. |
| Project lookup | Antigravity project id lookup per CLIProxyAPI `FetchAntigravityProjectID` | `private` | Required for quota calls. Endpoint pinned during validation. |
| Quota summary | `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` | `private` | Merged pools with five-hour and weekly windows, plus `userTier`. Unvalidated for Headroom. |
| Legacy quota | `fetchAvailableModels` and `retrieveUserQuota` on the same hosts | `private` | Five-hour windows per model only. Fallback. |
| Status line JSON | `agy` runtime data: `quota` with `remaining_fraction`, `reset_time`, `reset_in_seconds` | `official` | Fallback and shape reference. |
| `/usage` (alias `/quota`) and `/credits` | CLI commands [S2] | `official` | Fallback only. Command existence does not establish credit access. |

The API hosts are `https://cloudcode-pa.googleapis.com` and `https://daily-cloudcode-pa.googleapis.com`. The client secret is public to installed apps. This page does not reproduce it. Read the constants from CLIProxyAPI source at the pinned version.

Google's Gemini API-key mode is direct API configuration. It does not establish an Antigravity account session [S1]. It could become a separate Gemini spend connector with the next step `api_key`. An ACP wrapper does not prove that quota fields are available.

### Refresh and reconnect

Refresh is `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token` and the installed-app client constants from CLIProxyAPI `internal/auth/antigravity/constants.go`. Expiry comes from `expires_in` recorded at exchange time. Google returns `invalid_grant` when the user revokes the app in their Google account or the refresh token expires; that is definitive and sets `reconnect_required` with `refresh_rejected`. A 401 from the quota endpoint gets one refresh and retry, then is definitive. Reconnect repeats the pasted-redirect flow; the email from user info must match.

## Available packages and limits

| Tool | Value | Limit |
| --- | --- | --- |
| CLIProxyAPI (MIT, written in Go) | Reference for the OAuth flow, constants and project lookup; port the logic to TypeScript. It reads no quota | Tracks private endpoints; pin the reviewed version. |
| Official `agy` CLI | Fallback remote OAuth flow and status-line schema | Linux Secret Service keyring; container persistence needs proof. |
| Official API-key mode | Headless Gemini API requests | Not Antigravity subscription login [S1]. |
| Antigravity ACP implementations | Agent-process integration | Community surfaces may change. |
| OpenUsage and ai-usagebar | Quota endpoint and merge rules; community patterns | Private behavior needs validation. |

## Prior observations

An earlier CLI check returned two model-group weekly quota and reset rows. A credits command failed to establish a usable balance. The JSON output wrapped a text table; it was not proof of a stable structured metric API.

## Cannot promise

- A stable quota endpoint or a specific refresh interval. A changed shape yields `invalid_response` for that metric.
- Google keeps the OAuth client, scopes or redirect valid. A revoked token shows `reconnect_required`.
- A weekly window when only the legacy routes answer.
- Credit balance, prepaid value, plan allowance or banked reset count.
- Organization-wide or admin-level accounting.
- Reset redemption, plan changes or credit purchases.
- That a Gemini API key exposes the signed-in Antigravity account.

## Implementation and validation checklist

- [ ] Gate the connector behind a per-provider enable flag and label every metric `official` or `private`.
- [ ] Prove the paste-redirect flow from a separate browser device.
- [ ] Prove the project id lookup and the quota summary call on a test account, including both windows per pool.
- [ ] Prove the legacy fallback merges by worst remaining fraction and reports no weekly window.
- [ ] Prove token refresh, rotated refresh-token persistence and repeat collection after restart.
- [ ] Prove revocation handling: `reconnect_required` with the old snapshot kept.
- [ ] Capture synthetic fixtures for success, partial response and schema drift; bump the connector version on any parser change.
- [ ] Compare each parsed quota and reset field with the provider UI.
- [ ] Keep credits `unknown` until a validated balance source exists.
- [ ] Make disconnect delete only this connection's credentials and revoke the token where Google documents it.

## Sources

- [S1] Google Antigravity, [CLI installation and authentication workflows](https://antigravity.google/docs/cli/install/), reviewed 2026-10-01.
- [S2] Google Antigravity, [CLI reference](https://antigravity.google/docs/cli/reference/), reviewed 2026-10-01.
- [S3] Google Antigravity, [status-line JSON fields](https://antigravity.google/docs/cli/statusline/), reviewed 2026-10-01.
- [S4] [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), MIT, written in Go, v8.0.8 released 2026-10-01. Files read: `internal/auth/antigravity/auth.go`, `internal/auth/antigravity/constants.go`, `sdk/auth/antigravity.go`. Reviewed 2026-10-01.
- [S5] ai-usagebar, [endpoint reference](https://github.com/akitaonrails/ai-usagebar/blob/main/docs/vendor-endpoints.md), reviewed 2026-10-01.
- [S6] OpenUsage, [Antigravity provider doc](https://github.com/robinebers/openusage/blob/main/docs/providers/antigravity.md) - `retrieveUserQuotaSummary`, legacy fallbacks and `userTier`. Reviewed 2026-10-01.
