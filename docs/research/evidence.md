# Evidence register

This project consolidates an earlier research conversation, a source review and a CLIProxyAPI source inspection, all on 2026-10-01. No live sign-in, credential read, account mutation or inference request was performed during project setup.

## Proof levels

| Level | Establishes | Does not establish |
| --- | --- | --- |
| Official documentation | An advertised API, command or restriction | Availability for every account or deployment |
| Source inspection | A code path or response parser exists | Official support, permission to redistribute, or current account compatibility |
| Prior account observation | A field was reported for one earlier account check | Reproducibility, current value or support for other plans |
| End-to-end validation | The tested flow works under recorded conditions | Untested operating systems, plans or future versions |

Current Headroom implementation proof is limited to repository/documentation checks. There are no Headroom connector test results yet.

## Earlier observations carried forward

These entries are sanitized conversation records. Earlier temporary report paths were unavailable during setup, so their raw evidence could not be re-audited. Do not present them as new tests or use exact personal balances as fixtures.

| Provider | Earlier reported observation | Limitation |
| --- | --- | --- |
| Codex | Official app-server returned quota, credits, nonzero reset inventory and daily token buckets | One account; remote deployment and other account profiles not proved |
| Claude | An OAuth usage response contained short-window and weekly percentages and reset times | No banked-reset inventory or prepaid wallet was established in that response |
| Cursor | A DashboardService response contained monthly total/Auto/API usage, cycle dates and included/bonus spend | Private endpoint; spend divided by a configured cap is not the quota percentage |
| Copilot | SDK account quota call returned entitlement, used amount and remaining percentage without a model prompt | SDK/CLI-version-specific and one account scope |
| Vercel | Gateway credits endpoint returned a balance and total-used value | Did not establish the requested monthly allowance or correct team scope |
| Grok | OpenUsage's collector returned a consumer weekly quota | Does not prove every Grok product or plan shares the same quota |
| Antigravity | CLI usage output returned model-group quota/reset information; credit command failed | Wrapped text output was not a complete structured metric API |

## Corrections to earlier assumptions

1. A collector reading local CLI credentials does not prove a laptop helper is necessary. Codex, Copilot and Grok document device flows; Antigravity documents remote URL/code login. Cursor community code implements approval with server polling. CLIProxyAPI implements the Codex, Claude, Antigravity and xAI sign-ins as in-process clients and drives them from a management API, which is the design [ADR 0001](../decisions/0001-direct-provider-clients.md) adopts.
2. ACP does not provide a standard account-wide billing, weekly-quota or reset-inventory interface. Agent-session usage is a different metric.
3. Anthropic's hosted unmodified-CLI allowance does not imply permission to build custom Claude.ai token collection. A local helper does not resolve that policy boundary.
4. OpenAI's current app-server documentation restricts commercial/hosted use of its authentication and directs those cases to Sign in with ChatGPT. Earlier statements that any hosted service could simply reuse CLI authentication were incomplete. Self-hosted/open-source deployment fit must also be checked against the current wording before implementation.
5. A redeemed credit-code list is not necessarily a current monetary balance. A configured spending cap is not an included monthly entitlement.
6. The official Claude Code status line cannot be a passive collector. Its documentation states `rate_limits` appears only after the first API response in a session, so the hosted-unmodified-CLI route from the first draft would require a billable prompt per refresh.
7. The GitHub Copilot SDK does document a quota reset date (`resetDate`) and an unlimited sentinel (`entitlementRequests` of `-1`). The first draft recorded the reset as unavailable.

Source for the Codex correction: [official Auth endpoints section](https://learn.chatgpt.com/docs/app-server#auth-endpoints). Source for Claude's boundary: [official authentication and credential conditions](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use). Source for the status-line correction: [status line available data](https://code.claude.com/docs/en/statusline). Source for the Copilot correction: [SDK usage and billing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing).

## Required future evidence

Run the checks in [the validation plan](../validation.md) after implementation and account-owner approval. Record tool versions, platform, product surface, operation and sanitized result. Use immutable source revisions when an adapter is adopted. Do not infer readiness from a package's provider list alone.

## Headroom validation results

| Date | Check | Result |
| --- | --- | --- |
| 2026-10-01 | `codex login --device-auth` (CLI 0.159.3) run headless on macOS with `CODEX_HOME` set to an empty directory and stdin closed | Printed the verification URL and a one-time code with a fifteen-minute expiry, wrote only `log/codex-login.log`, polled until killed. No sign-in was completed, so `auth.json` creation and refresh remain to be observed |
| 2026-10-01 | Compiled Headroom binary driven through owner sign-up, `POST /api/attempts` for Codex `cli_login`, poll and cancel | The real CLI ran under the runner, the attempt showed the URL and code, cancel killed it and removed the attempt directory, no connection was created |
| 2026-10-01 | `grok login --device-auth` (CLI 1.0.46) run headless with `GROK_HOME` set to an empty directory | Printed the device URL carrying the code and the code itself on stderr, honoured the home variable, polled until killed. No sign-in was completed |
| 2026-10-01 | `claude auth login` (CLI 2.1.286) run headless with `CLAUDE_CONFIG_DIR` set to an empty directory and stdin closed | Printed the authorization URL with the platform code-callback redirect and a `Paste code here` prompt, wrote only `.claude.json`, waited until killed. No sign-in was completed |
| 2026-10-01 | The same command with a logging `open` shim first on `PATH`, after the maintainer's browser ended on `platform.claude.com/oauth/code/success` during a Headroom test on a Mac | The CLI called `open` once with an authorization URL whose `redirect_uri` was `http://localhost:<random port>/callback`, while printing the platform code-callback URL. Same client id, scopes, challenge and state in both. Cause of the observed page: the CLI's own loopback listener received the code because the server and browser were one machine. Headroom's runner now shadows `open` and `xdg-open`, and the Claude step is polled while it waits for the code |
| 2026-10-01 | Headroom Claude Connect on the maintainer's Mac with the browser shim in place, code pasted | macOS showed "Keychain Not Found: A keychain cannot be found to store 'unknown'" and the attempt ended `failed` with no `.credentials.json`. The pinned binary stores the token through `security` on macOS and falls back to the file only after a non-zero, non-timeout `security` exit (source-inspected: read exit 44 is "absent", 36 is "locked"). The runner now shims `security` with those codes. A completed Mac login through the shim is still to be observed |
| 2026-10-01 | Headroom Claude Connect on the maintainer's Mac with both shims, code pasted | The CLI wrote `.credentials.json` through its plaintext fallback, Headroom encrypted it, the profile call resolved identity and the token expiry was eight hours out. The first collection ended `invalid_response` because `limits[].scope`, `extra_usage.used_credits` and `extra_usage.monthly_limit` are null on the live response. The schema now accepts them; field names and types are recorded in the dossier, values were not |
| 2026-10-01 | Headroom Antigravity Connect on the maintainer's account, then the first collection | Sign-in, token exchange, userinfo identity and `loadCodeAssist` worked. `retrieveUserQuotaSummary` with an empty body answered 403 "no valid license" on both hosts; with the `cloudaicompanionProject` from `loadCodeAssist` in the body it answered 200 with the bucket groups. The connector now makes both calls per run |
| 2026-10-01 | Headroom Codex, Grok, Copilot and Cursor connections on the maintainer's accounts, first collections | Codex: `wham/usage` has `rate_limit.secondary_window` and `additional_rate_limits` as null on a Pro account; the schema now accepts them, and `wham/rate-limit-reset-credits` answered 200 with three credits. Grok: billing carries `onDemandUsed`, `prepaidBalance` and `productUsage`, now collected. Copilot: the gh client id with `read:user` is accepted by `copilot_internal/user`. Cursor: cycle bounds are epoch-millisecond strings, now parsed, and percentages are rounded to two decimals. Synthetic live-shape fixtures were added for each; values were not recorded |
| 2026-10-01 | Web UI driven in a browser against the compiled binary with Codex, Grok and Vercel enabled | Owner setup, sign-in session, connect wizard to a real Codex device code with countdown and cancel all worked; a colour-scheme bug in the stylesheet was found and fixed |
| 2026-10-08 | Claude prepaid credits and the Max monthly API credits, run by the maintainer with his own claude.ai and Console sign-ins; read-only GETs | `GET api.anthropic.com/api/oauth/organizations/{org}/prepaid/credits` with the claude.ai token answered 200 with `amount`, `currency`, `next_expires_at`, `tranches` and `promo_tranches`, all empty on the observed account. The same path with a keyless Console OAuth token (`claude` `/login`, Console account; scope `user:inference user:profile`) answered 403 "This endpoint is only available for Pro and Max plans". `platform.claude.com/api/organizations/{org}/prepaid/credits` with that token answered 403 `oauth_token_not_accepted`, and the Admin API `cost_report` with an API key answered 403 "Missing permissions" on the individual Console organization. The Max monthly API credits sit in the linked Console organization, so only a Console browser session can read them; the owner chose not to collect them. `claude auth login --console` skips the sign-in menu and always creates an API key. Values were not recorded |

## OpenUsage inspection

Inspected on 2026-10-01 from the [repository](https://github.com/robinebers/openusage): `docs/providers/{grok,copilot,antigravity,cursor,claude,codex}.md` and `Sources/OpenUsage/Providers/{Grok,Copilot}/*UsageClient.swift`. Findings carried into the dossiers: Grok's billing route on `cli-chat-proxy.grok.com` with the `X-XAI-Token-Auth` header and the 412 behaviour for team logins; Copilot's exact client headers, the AI-credits billing model since June 2026 and the org billing REST path; Antigravity's `retrieveUserQuotaSummary` as the only merged-pool endpoint with legacy per-model fallbacks; Cursor's REST fallbacks; the fact that a Claude `setup-token` cannot read limits. OpenUsage reads local credentials and has no login flows. None of it was executed. It is source-inspected evidence.

## CLIProxyAPI inspection

Inspected on 2026-10-01 at v8.0.8 from the [repository](https://github.com/router-for-me/CLIProxyAPI): `sdk/auth/*.go` (authenticator interface, Codex device flow, Claude and Antigravity OAuth, xAI device flow, plaintext JSON file store with mode 0600), `internal/api/handlers/management/auth_files_provider_oauth.go` and `auth_files_oauth_callback.go` (management endpoints that return an authorization URL and state, a status poll, and a forwarder that listens on the provider's localhost callback port and redirects into the management callback), and `internal/runtime/executor/helps/codex_quota.go` (parser for Codex `wham/usage` and websocket quota events). None of this was executed. It is source-inspected evidence.

## Research dates

Provider dossiers mark their review date and sources. Package observations in [the tool catalog](tools.md) come from the conversation and linked repositories; exact historical package versions are not dependency pins. Recheck release and license metadata when adopting a package.
