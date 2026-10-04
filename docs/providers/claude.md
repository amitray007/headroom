# Claude

> Reviewed: 2026-10-01. Claude is the highest-policy-risk connector. It is off by default and needs explicit owner opt-in.

## Scope and recommendation

Sign in through the official `claude` CLI, as ADR 0001 decides. The primary route is `cli_login`: the shared CLI login runner starts the official `claude` login headless with `CLAUDE_CONFIG_DIR` set to a per-attempt directory and an allowlisted environment. The CLI prints an authorization URL and then asks for a pasted code. Headroom shows the URL (next step `paste_redirect`), the user signs in and pastes the displayed code, and the runner feeds it to the CLI. The CLI writes `.credentials.json` under the attempt directory. Headroom reads it once, encrypts it and deletes the directory. OpenUsage reads `~/.claude/.credentials.json` or `$CLAUDE_CONFIG_DIR/.credentials.json` [S8]. The exact headless behaviour of the current `claude` version is unvalidated. The remote and manual authentication page [S1] is the documented reference.

The second route is `import`: the user pastes an existing `.credentials.json` through the `paste_file` next step. The fallback is the direct PKCE client from CLIProxyAPI (the previous primary route). Refresh and collection are direct HTTP against the stored token and never go through the CLI. Collection reads `GET https://api.anthropic.com/api/oauth/usage`, the endpoint the official CLI calls.

Policy posture: Anthropic says third parties "may not collect, store, or intermediate Claude.ai credentials or session tokens" [S2]. CLI login means sign-in completes in Anthropic's own flow, which is the ADR's reason for preferring it. Storing the token for usage reads remains outside the stated permitted uses. This connector is off by default and requires explicit owner opt-in (D16). It stores only the owner's own credentials, routes no inference and must not be offered as a hosted service. If Anthropic changes the endpoint or revokes the token, the connection shows `reconnect_required`.

No official passive route exists. The status-line document says `rate_limits` appears "only for claude.ai Pro and Max subscribers ... and only after the first API response in the session" [S3]. A status line therefore cannot give passive collection without a billable prompt.

## Evidence status

| Claim | Status | Basis |
| --- | --- | --- |
| Status-line `rate_limits` appears only for Pro and Max, and only after the first API response in a session | documented | [S3] |
| Status line can carry five-hour and seven-day percentages and resets | documented | [S3] |
| Anthropic restricts third-party handling of Claude.ai credentials | documented | [S2] |
| Anthropic permits some hosted unmodified Claude Code use subject to conditions | documented | [S2] |
| Claude Code supports remote and manual authentication scenarios | documented | [S1] |
| Headless `claude auth login` (CLI 2.1.286) with no TTY prints `If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...&redirect_uri=https://platform.claude.com/oauth/code/callback...` and then `Paste code here if prompted >`, honouring `$CLAUDE_CONFIG_DIR` | validated | Run by this project on 2026-10-01 with an isolated config directory; no account was signed in. Writing of `.credentials.json` on success remains to be observed |
| The same headless login also spawns `open <url>` where the URL's `redirect_uri` is `http://localhost:<random port>/callback`, served by a listener inside the CLI; the printed URL and the opened URL share one PKCE challenge and state | validated | Run by this project on 2026-10-01 with a logging `open` shim on `PATH`. On a machine with a browser the CLI completes the login through its own listener and the browser ends on `platform.claude.com/oauth/code/success`; the pasted code is then never asked for. Headroom's runner shadows `open` and `xdg-open` so only the printed URL is used |
| On macOS the CLI stores the OAuth token in the login keychain through `security`, not in `.credentials.json`. With `HOME` pointed at the attempt directory macOS shows "Keychain Not Found: A keychain cannot be found to store 'unknown'" after the code is accepted, and the CLI exits without a credentials file | validated | The maintainer hit the dialog on 2026-10-01 while testing on his Mac; the attempt ended `failed` |
| Keychain failure handling in CLI 2.1.286: `find-generic-password` exit 44 means no item, exit 36 means locked; a write that exits non-zero without timing out is treated as a definitive keychain failure and the CLI falls back to writing `.credentials.json` with mode 0600 in `$CLAUDE_CONFIG_DIR`, printing `Warning: Storing credentials in plaintext.` | source-inspected | Read from the pinned binary on 2026-10-01. Headroom's runner shims `security` with exactly those exit codes. That the fallback file appears after a real sign-in is unvalidated until one completes on a Mac host; Linux containers never reach the keychain path |
| OpenUsage reads `~/.claude/.credentials.json` or `$CLAUDE_CONFIG_DIR/.credentials.json` | source-inspected | OpenUsage Claude provider doc [S8] |
| A long-lived `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`) can run the model but cannot read session and weekly limits | source-inspected | OpenUsage Claude provider doc [S8] |
| Fallback sign-in uses PKCE with the Claude Code public OAuth client and a localhost callback on port 54545; a pasted callback URL is accepted | source-inspected | CLIProxyAPI `internal/auth/claude` and `sdk/auth/claude.go` [S6] |
| `GET https://api.anthropic.com/api/oauth/usage` returns five-hour and seven-day windows, model-scoped seven-day buckets, extra usage and reset grants | source-inspected | ai-usagebar [S5, S7] |
| With a Headroom CLI-login credential, `GET /api/oauth/usage?cedar_ember=1` answers 200 with `five_hour` and `seven_day` (`utilization` percent, `resets_at`, null `*_dollars` and `locked_reason`), many null model and surface buckets, `limits` with kinds `session`, `weekly_all` and `weekly_scoped` (the last with `scope.model.display_name`; the others with `scope: null`), `extra_usage` with null `used_credits` and `monthly_limit` while disabled, `cedar_ember` with `eligible`, `ineligible_reason`, empty `grants`, a `spend` block in minor units, and `seven_day_breakdown` rows per surface (Claude Code, Chats, Cowork, Other) | validated | Observed by this project on 2026-10-01 against Amit's Max account; only field names and types were recorded, values were not. The synthetic fixture `usage-live-shape.json` mirrors it. The first live collection failed on the three nullable fields and the schema was corrected |
| Scoped model and reset-grant fields match the current account shape | validated | As above; reset grants were empty on the observed account, so the grant element shape stays source-inspected |
| Reset grants are withheld from the Claude Code sign-in: `cedar_ember.eligible` is false with `ineligible_reason: "surface"` and `grants` is empty, while the owner's Claude app showed grants for the same account. Headroom therefore emits no grant count when the response is ineligible, instead of reporting zero | validated | Observed by this project on 2026-10-02 against Amit's Max account; field names, booleans and the reason string were recorded, no account values |
| The reset-grant block is gated on the client identity. With `user-agent: Headroom` the usage response is ineligible (`ineligible_reason: "surface"`, empty `grants`); with `user-agent: claude-cli/2.1.285 (external, cli)` the same token gets `eligible: true`, `ineligible_reason: null` and the grant list. A version floor exists: public sources report `ineligible_reason: "cli_version"` below 2.1.279 [S5], so the constant `claudeCodeUserAgent` must be bumped if Anthropic raises it. Known reasons: config_off, tier, seat, mobile, surface, cli_version, no_grant, tenure, other_experiment, unavailable, unknown. A grant element has the keys `id` (the redemption handle, never parsed or stored), `label`, `resets_total`, `resets_left`, `starts_at`, `ends_at`, `clears` (array of window names), `paused`, `usable_now`, `use_requires_limit`, `percent_used`, `blocking`, `arm`; dates are ISO strings, counts are numbers, flags are booleans | validated | Observed by this project on 2026-10-02 against Amit's Max account; only field names and types were recorded, no values. Public references: OpenUsage 0.7.13 and CodexBar 0.70.0 use the same client identity and count rule |
| A prior OAuth usage response contained session and week values | prior observation | Sanitized earlier research; not a current test |

## Metrics

| Metric | Availability | Unit and source | Notes |
| --- | --- | --- | --- |
| Session or five-hour limit | `available` when returned | Used percentage and reset time from `api/oauth/usage` | `private`. Label it five-hour only when the field says so. |
| Weekly limit | `available` when returned | Used percentage and reset time | `private`. Do not derive it from a session value. |
| Model-scoped weekly buckets | `available` when returned | Collector-specific bucket keys | `private`. Keep provider keys; do not invent a model label. |
| Monthly limit | `unsupported` | Not in the response | Unavailable for v1. |
| Extra usage | `available` while switched on | `extra_usage` | `private`. Additional-use spending, not a prepaid wallet. Switched off on the account means no metric and no `partial` state; the account validated on 2026-10-01 had it off. |
| Credits or prepaid balance | `unknown` | Not documented | Do not show a guessed wallet balance. |
| Reset countdown | `available` when returned | Provider reset time | `private`. |
| Banked reset count | `available` when eligible | `cedar_ember.grants`: sum of `resets_left` over grants that are not paused, have `resets_left >= 1`, started and not ended | `private`. Validated 2026-10-02. Display only: counted and listed with expiry, never redeemed. An ineligible response gives no count (unknown, not zero). |
| Reset redemption | `unsupported` | Not documented as a supported action | Do not offer a reset button. |
| Usage history | `unsupported` | Not account history | Headroom snapshots only. |
| Seven-day share by surface | `unknown` | `seven_day_breakdown.rows[].percent` per surface | `private`. Present on the live response of 2026-10-01; not collected yet. |
| Admin versus non-admin | Policy and workspace dependent | Anthropic rules | Do not infer access from a subscription tier. |

## Connect workflow

1. Show the connector only after the owner turns on the Claude enable flag and accepts the policy notice (D16).
2. Create an attempt (`created`) and its directory. The runner starts the official `claude` login with `CLAUDE_CONFIG_DIR` set to that directory.
3. Parse only the authorization URL. Return the next step `paste_redirect` (`awaiting_input`) and ask to be polled meanwhile. The user signs in on Anthropic's site and copies the displayed code. The runner's browser shim keeps the CLI from opening its loopback-redirect URL on the server.
4. The user pastes the code into Headroom. The runner writes it to the CLI. If a poll finds `.credentials.json` before any paste, the login completed through the CLI's own listener and the step ends without input. Stop on exit success, failure, timeout or expiry (`expired`). Support cancel (`cancelled`), which kills the process.
5. On success, read `.credentials.json` once, encrypt it and move to `validating`. On macOS hosts the runner's `security` shim is what makes the CLI write that file instead of the login keychain. Delete the attempt directory in every terminal state.
6. Run one read-only `GET /api/oauth/usage`. Do not make a model request.
7. Store the encrypted credentials, capabilities and first snapshot. Mark the attempt `succeeded` and the connection `ready`, or `partial` when usage fails.
8. Refresh before collection when the access token nears expiry, or after a 401. Persist a rotated refresh token first. A definitive failure sets `reconnect_required`.

### Credential import

The user pastes an existing `.credentials.json` through the next step `paste_file` (`awaiting_input`). Headroom checks the shape, encrypts the file and never writes the plaintext back. A wrong-shape file ends the attempt as `failed`. The auth method is `import`. Continue at step 6.

### Direct client fallback

If the CLI route fails validation, use the direct PKCE client from CLIProxyAPI [S6]. Create an attempt with a PKCE verifier and state kept server-side. Return the next step `paste_redirect` with the authorization URL (`awaiting_input`). The browser lands on the client's registered localhost callback (port 54545), which a remote server cannot receive, so the user pastes the redirected URL or the displayed code. Verify state, exchange the code with the stored verifier, move to `validating` and continue at step 6. The auth method is `paste_redirect`. This route embeds the Claude Code public OAuth client.

### Status-line reference

The status line is not a collection route. Its `rate_limits` field appears only after the first API response in a session [S3], so Headroom would need a billable prompt to refresh it. Use it as a shape reference only.

## APIs and tools

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| CLI login | Official `claude` login with `CLAUDE_CONFIG_DIR` set | `official` | Sign-in only, in the runner. |
| Credentials file | `.credentials.json` under the config directory | `official` | Read once, encrypt, delete. |
| Token refresh | Anthropic OAuth token endpoint, `POST`, with the stored refresh token | `private` | Refresh in the connector. |
| Usage | `GET https://api.anthropic.com/api/oauth/usage` | `private` | Five-hour and seven-day windows, scoped buckets, extra usage, reset grants. |
| Fallback authorization | Claude Code PKCE authorization URL with the public client and the 54545 localhost redirect | `private` | Direct client fallback. Exact URL pinned during validation. |
| Status line | Claude Code runtime data | `official` | Shape reference only. |

Community research found the `/api/oauth/usage` path, five-hour and seven-day and scoped model buckets, `extra_usage`, and a `cedar_ember` reset-grant shape in ai-usagebar [S5]. Its usable-reset count filters grants by eligibility, current usability, paused state and resets remaining; omitted output does not prove zero. `extra_usage` describes additional-use spending, not necessarily a prepaid wallet. The pi-ai package also contains reset list and consume helpers; keep those outside the connector until Anthropic documents a supported action.

### Refresh and reconnect

Refresh is `POST https://platform.claude.com/v1/oauth/token` with the public client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e` that Claude Code uses; both constants are in CLIProxyAPI `internal/auth/claude/anthropic_auth.go` [S6]. Expiry comes from the expiry field in `.credentials.json`. Identity can be re-read from `GET https://api.anthropic.com/api/oauth/profile` [S6]. `invalid_grant` is definitive and sets `reconnect_required` with `refresh_rejected`. A 401 from `api/oauth/usage` gets one refresh and retry, then is definitive. Reconnect runs the CLI login again or accepts a pasted `.credentials.json`; the identity must match. Whether a later sign-in elsewhere invalidates this refresh token is a validation item.

## Available packages and limits

| Package or tool | Value | Limit |
| --- | --- | --- |
| CLIProxyAPI (MIT, written in Go) | Reference for the fallback PKCE flow, client settings and callback handling; port the logic to TypeScript | Tracks private endpoints; pin the reviewed version. |
| Official Claude Code | Login only, in the runner | No passive quota; must stay unmodified; headless behaviour unvalidated. |
| OpenUsage | Reference for the credentials file and usage endpoint | Private endpoint risk. |
| `claude-agent-acp` | Agent interoperability reference | Does not add subscription fields. |
| `ai-usagebar` | Endpoint and field reference | Not a credential runtime. |
| `@oh-my-pi/pi-ai` | Reference for reset data shapes | Private protocol; validate independently. |
| `quota-axi` | Local quota-display reference | Assumes existing credentials. |

## Prior observations

Earlier research observed OAuth-backed values resembling session and weekly percentages with reset times. No personal values, account identifiers, tokens or balances are retained in this project. The observation shows a private response shape only.

## Cannot promise

- Anthropic permits this connector. The posture is owner opt-in, own credentials only, no inference routed.
- The private usage endpoint keeps its path or shape. A changed shape yields `invalid_response` for that metric.
- A refresh token stays valid. Anthropic can revoke it; the connection then shows `reconnect_required`.
- The localhost callback works from a remote server. The user must paste the code or redirect. A browser that lands on `platform.claude.com/oauth/code/success` instead of the code page went through a loopback listener, not through Headroom's step.
- A long-lived `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`) is enough. It can run the model but cannot read session and weekly limits, so only a real login works for Headroom [S8].
- Prepaid balance, banked reset inventory or redemption is available.
- ACP or the status line gives passive collection.

## Implementation and validation checklist

- [ ] Keep the connector off by default behind the enable flag and policy notice (D16).
- [ ] Prove the headless `claude` login on Linux prints a URL, accepts a pasted code and writes `.credentials.json` without a keyring.
- [ ] Prove the runner deletes the attempt directory in every terminal state.
- [ ] Prove import rejects a wrong-shape file.
- [ ] Prove the code-paste flow from a browser on a different machine than the server. For the direct fallback, test both a pasted URL and a pasted code.
- [ ] Prove token refresh, rotated refresh-token persistence and repeat collection after restart.
- [ ] Prove revocation handling: `reconnect_required` with the old snapshot kept.
- [ ] Capture synthetic fixtures for success, partial response and schema drift of `api/oauth/usage`; bump the connector version on any parser change.
- [ ] Confirm the usage read makes no model request.
- [ ] Test two Claude connections without credential or snapshot leakage.
- [ ] Do not add reset redemption until Anthropic documents a supported action.

## Sources

1. [S1: Claude Code authentication, official](https://code.claude.com/docs/en/authentication) - sign-in and remote-environment guidance. Reviewed 2026-10-01.
2. [S2: Claude Code legal and compliance, official](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) - third-party authentication and hosted-binary conditions. Reviewed 2026-10-01.
3. [S3: Claude Code status line, official](https://code.claude.com/docs/en/statusline) - `rate_limits` fields and their availability limits. Reviewed 2026-10-01.
4. [S4: Claude Code remote environments, official](https://code.claude.com/docs/en/remote-environments) - remote deployment context. Reviewed 2026-10-01.
5. [S5: ai-usagebar Claude provider reference](https://github.com/akitaonrails/ai-usagebar) - community field and reset-grant reference. Reviewed 2026-10-01.
6. [S6: CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) - MIT, written in Go, v8.0.8 released 2026-10-01. Files read: `internal/auth/claude`, `sdk/auth/claude.go`. Reviewed 2026-10-01.
7. [S7: ai-usagebar endpoint reference](https://github.com/akitaonrails/ai-usagebar/blob/main/docs/vendor-endpoints.md) - `api/oauth/usage`. Reviewed 2026-10-01.
8. [S8: OpenUsage Claude provider](https://github.com/robinebers/openusage/blob/main/docs/providers/claude.md) - credentials file locations and the `setup-token` limit. Reviewed 2026-10-01.
