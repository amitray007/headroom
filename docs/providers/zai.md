# Z.ai GLM Coding Plan

Reviewed: 2026-11-06.

## Scope and recommendation

Track an individual z.ai GLM Coding Plan through ZCode’s browser approval flow and an encrypted business session. New connections require no pasted API key. Existing key credentials remain readable for continuity. Read quota over direct HTTP; no inference or account action is part of monitoring. This connector targets global z.ai only, not BigModel China, team billing or pay-as-you-go balances.

## Evidence status

Browser approval and business-session exchange are **source-inspected** in the official ZCode client; session headers and customer identity are source-inspected in the official z.ai console. The quota route and legacy raw-key Authorization header are **source-inspected** in z.ai’s own usage plugin at revision `0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254`. The route is **private**: published client code is not a documented API contract. Current Coding Plan documentation describes five-hour and weekly credit pools. Legacy token and monthly MCP response shapes and window unit codes are source-inspected in CodexBar. Headroom's implementation and fixtures are independent, synthetic protocol tests. Live quota, rejected keys, rate limits and deployment remain **unvalidated**.

## Metrics

| Metric | Interface | Evidence | Meaning |
| --- | --- | --- | --- |
| `quota.18000s`, `quota.604800s` | private | source-inspected | Used percent of the five-hour and weekly coding pools; `CREDIT_LIMIT` and legacy `TOKENS_LIMIT` are accepted without calling their counts model tokens |
| Other explicit coding windows | private | source-inspected | Separate percent buckets, identified by their reported duration; never summed |
| `mcp.monthly` | private | source-inspected | Monthly MCP percent, only when a `TIME_LIMIT` entry with the legacy monthly marker is returned |
| `mcp.monthly.used`, `.limit`, `.remaining` | private | source-inspected | Optional individual tool-call counts, in requests, separate from coding quota and money |
| `reset_credits.available_count`, `reset_credits.five_hour.available_count`, `reset_credits.weekly.available_count` | private | source-inspected | Unexpired reset-card counts, total and by five-hour/weekly target, plus each card’s expiry in `reset_credits` |
| Reset times | private | source-inspected | `nextResetTime` epoch milliseconds on the corresponding bucket; missing or invalid times remain unknown |

`unit` codes 1, 3, 5 and 6 mean days, hours, minutes and weeks for coding windows. For `TIME_LIMIT`, `(unit: 5, number: 1)` is the legacy monthly MCP marker, not a one-minute window. No monthly coding allowance is inferred from it. Percentages are provider-reported; exact usage/limit counts refine them only when both are valid and the percentage is present. Missing or malformed percentages stay unknown, never zero. Missing coding pools are unknown; an omitted optional MCP pool is omitted. Unknown window types and duplicate buckets cannot overwrite known values.

## Connect workflow

1. Select Z.ai in Connect. Headroom generates a fresh 32-byte polling secret and calls ZCode’s public sign-in initializer with `provider: zai`.
2. Open the returned official z.ai authorization URL and approve. Headroom keeps the polling secret encrypted on the server; it never reaches the browser or a URL. The provider’s registered callback is left unchanged, so remote servers need no localhost redirect.
3. Headroom polls the fixed ZCode endpoint. A ready reply supplies the z.ai OAuth token; exchange it once at the business-login endpoint for a business JWT; retain the same approval’s ZCode JWT for reset-card reads. No API key, project or access-token resource is created.
4. Read `customerNumber` from the business identity endpoint and bind the connection to `zai:<customerNumber>` with `strong` assurance. Reconnect must resolve the same identity; every collection and renewed business token rechecks it. The sign-in reply’s name or email is only a display label.
5. Read quota with the business JWT. Renew that JWT over direct HTTP while the original OAuth token remains valid. Z.ai’s client currently has no root OAuth refresh implementation: expired or definitively rejected sign-in requires browser Reconnect. There is no known root OAuth refresh endpoint.
6. Disconnect removes Headroom’s encrypted session (`local_only`). No provider logout endpoint is called.

Existing key credentials keep their previous weak full SHA-256 fingerprint identity and collection behavior. Their account identity cannot safely be inferred from a browser session, so they are never silently rebound: link a new browser connection when replacing one. No CLI configuration, browser cookies or environment credentials are imported.

## APIs and tools

| Operation | Endpoint | Headers | Evidence |
| --- | --- | --- | --- |
| Begin browser approval | `POST https://zcode.z.ai/api/v1/oauth/cli/init`, body `{provider: "zai"}` | `Authorization: Bearer <random polling secret>`, JSON | private, source-inspected official ZCode client; public initialization observed without an account |
| Poll approval | `GET https://zcode.z.ai/api/v1/oauth/cli/poll/<encoded flow id>` | Same polling-secret Bearer header | private, source-inspected official client |
| Browser approval | `https://chat.z.ai/api/oauth/authorize` | Browser navigation only | private, source-inspected; public client id `client_P8X5CMWmlaRO9gyO-KSqtg`; callback `https://zcode.z.ai/api/v1/oauth/cli/callback/zai` |
| Exchange business session | `POST https://api.z.ai/api/auth/z/login`, body `{token: "<OAuth access token>"}` | JSON, no credential-bearing URL | private, source-inspected official `ZaiBusinessTokenResolver` |
| Resolve business identity | `GET https://api.z.ai/api/biz/customer/getCustomerInfo` | `Authorization: Bearer <business JWT>` | private, source-inspected z.ai console |
| Collect quota | `GET https://api.z.ai/api/monitor/usage/quota/limit` | Business JWT Bearer header; legacy stored keys use raw-key Authorization | private, source-inspected z.ai console and official usage plugin |
| Read reset-card inventory | `GET https://zcode.z.ai/api/v1/coding-plan/reset/status` | `Authorization: Bearer <ZCode JWT>`, `X-Bigmodel-Authorization: <raw business JWT>`, `Bigmodel-Target-Type: PERSONAL` | private, source-inspected official ZCode usage service |

ZCode initialization and polling use `{code: 0, data: ...}` envelopes. Initialization supplies seconds-since-epoch `expires_at`, `poll_interval_sec` and `flow_id`; the optional echoed polling secret must match. The ready reply’s `data.zai.access_token` is the OAuth token, not the returned ZCode application JWT. The ZCode application JWT is retained encrypted for the reset inventory; it never reaches the browser. Older sessions that did not retain it need one more browser sign-in. Business-session renewal preserves this token. Business exchange accepts the official client’s successful 0/200 codes and `access_token`/`accessToken` fields; missing data remains an error.

The console’s shared API client supplies the business JWT to the quota and customer endpoints. Quota success requires `success: true`, `code: 200` and `data.limits`; parse buckets separately. HTTP 401 and recognized authentication envelope codes are `authentication_required`, 403 is `permission_denied`, 429 is `rate_limited`, and 5xx is `provider_unavailable`. Unrecognized envelopes are `invalid_response`. Never surface provider error text. Requests have a timeout and refuse redirects. Only the browser approval URL may leave Headroom, after its host, path, client and callback are checked.

Reset status uses `{code: 0, data: {available_five_hour_resets: [...], available_week_resets: [...]}}`. Each card has a Unix-millisecond `expire_at`; ignore expired cards without inventing inventory. Parse the two lists independently: an empty valid list is zero, but a missing list or invalid entry makes only that window unknown. Repeated expiry times still represent separate cards; deterministic ids include target window, expiry and duplicate ordinal because this response supplies no card ids. Expose the two counts separately and a total only when both are known.

The reset query is optional: a missing/expired ZCode token, HTTP error or schema drift leaves quota values intact and reset availability unknown. It cannot revoke a working Coding Plan session. A legacy API key does not authorize reset inventory. The app never calls `/reset/opportunity`, `/reset/use` or `/reset/history-read`: issuing a card, consuming one and acknowledging history are account actions, outside this read-only feature. Cards shown here are already granted by z.ai.

## Available packages and limits

`@headroom/connector-zai` implements the shared connector contract using fetch and Zod. No SDK, CLI, browser automation, key creation or inference call is needed. Private routes may change without notice. A successful login proves session acceptance only; individual metrics still need their own values.

## Prior observations

No owner live-account observation has been recorded for Headroom’s z.ai connector. Public sign-in initialization returned the expected official approval host, callback, five-minute lifetime and two-second poll interval without an account on 2026-11-06; that does not prove quota access. The existing official usage plugin demonstrates quota access with a Coding Plan key. This is source inspection, not Headroom live validation.

## Cannot promise

No pay-as-you-go balance, subscription price, renewal date, reset action, team scope, China region or historical token analytics is provided. Current credit plans may omit the legacy monthly MCP bucket. Headroom will not invent it or send a model request to discover it.

## Implementation and validation checklist

- [x] Synthetic success, partial and schema-drift fixtures; modern and legacy windows, known zero, counts and reset timestamps.
- [x] Browser approval, renewal, denial, expiry, rate limits, redirect refusal and no credential leaks.
- [x] Reset-card counts, per-window drift, duplicate/expired cards, encrypted ZCode token continuity and localized failures.
- [x] Separate encrypted sessions, business identities and same-account reconnect binding.
- [x] Dashboard, Connect, demo and Mac feed checked with synthetic data.
- [x] `mise run check` and Mac tests pass.
- [ ] Owner checks reset inventory, per-card expiry and quota against the z.ai subscription page, key rejection, rate limits and deployment.

## Sources

- [Official GLM Coding Plan overview](https://docs.z.ai/devpack/overview) and [FAQ](https://docs.z.ai/devpack/faq), reviewed 2026-11-06: current credit windows and reset rules.
- [Official usage plugin](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs): quota route, Authorization header and legacy MCP fields.
- [CodexBar z.ai plugin](https://github.com/steipete/CodexBar/blob/b3b4d569755c3752265c6d60020de097ee4cfb04/Sources/CodexBarCore/Resources/Plugins/zai.js) and [reset tests](https://github.com/steipete/CodexBar/blob/b3b4d569755c3752265c6d60020de097ee4cfb04/TestsPlugin/ZaiPluginResetTests.swift): modern credit windows, duration codes and legacy MCP monthly marker. No implementation code is copied.

- [Official ZCode auth client](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts), [business-token resolver](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/services/src/providers/zaiBusinessTokenResolver.ts), [OAuth adapter](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/services/src/oauth/providers/zaiProviderAdapter.ts) and [expiry design](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/docs/oauth/jwt-expiry-reauthentication.md), reviewed 2026-11-06.
- Official z.ai console release inspected 2026-11-06: [quota API module](https://static.bigmodel.cn/z-ai-website/_next/static/chunks/0rkvs3iizs5b2.js) and [shared API client and customer identity](https://static.bigmodel.cn/z-ai-website/_next/static/chunks/0u6lq2er1j7j0.js). These published bundles prove the session-header wiring, not a Headroom live-account result. No source code is copied.

- [Official reset status implementation and headers](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/services/src/usage-stats/providers/bigmodelUsageQuotaProvider.ts) and [reset UI contract](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/docs/coding-plan-quota-reset-ui.md), inspected 2026-11-06: separate five-hour/weekly available cards, millisecond expiry and dual-token personal scope.
