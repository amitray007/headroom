# Data inventory: what the UI can show

Derived from code on 2026-10-02 (branch `main`, clean tree). Every claim cites a file and line. Nothing here comes from a live account. Fixtures are synthetic. Treat anything not listed as not available.

Citation roots: `<provider>/<file>:<line>` means `packages/connectors/<dir>/src/<file>`, where `<dir>` is `codex`, `claude`, `grok`, `antigravity`, `copilot`, `cursor` or `vercel-ai-gateway`. `core/<file>` is `packages/core/src/<file>`. `server/<file>` is `apps/server/src/<file>`. `web/<file>` is `apps/web/src/<file>`. `docs/...` is the repo `docs/` folder.

## 0. Ground rules the data imposes

1. Every metric row has the same twelve fields (core/connector.ts:86-98, server/routes/connections.ts:80-93). The UI gets no label, no display name and no description. Labels come from `providerMetricKey` plus `scope` plus `unit`, so the designer must own a key-to-label map (section 11).
2. `valueText` is a decimal string or `null`. `valueNum` is a derived float, `null` when the text is null or not numeric. Percent values are used share, 0 to 100, never remaining share. Antigravity reports remaining and the connector converts it (antigravity/index.ts:306).
3. `availability` other than `available` means there is no number to draw. The current web formatter prints "unknown" for every non-available value, including `unsupported` and `not_authorized` (web/format.ts:41-47). The design can do better because the row carries the reason as a value.
4. `unlimited: true` means draw "unlimited", not a bar. It is set only where the provider sends an explicit signal.
5. A metric row exists only if the connector emitted it. A missing row is not zero and not unknown. It means the provider omitted that bucket for this account.
6. Only the latest snapshot is exposed. There is no history route (section 9).
7. The detail response is the only place metrics live. The list response carries `metricCount` only (section 8). A one-page view of N accounts needs 1 list call plus N detail calls.

## 1. Codex

### 1.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `cli_login` (device code shown to the user, CLI runs once), `import` (paste `auth.json`) | codex/index.ts:135 |
| Scope | Client-chosen at connect; the web client never sends one, so `individual` (server/routes/attempts.ts:18, web/api.ts:178) | |
| Interface | `private` for the connector and every metric | codex/index.ts:134 |
| Plan names observable | `chatgpt_plan_type` from the id token, free-form string. Fixtures use `pro` and `plus`. Not mapped | codex/schemas.ts:29-35, codex/fixtures/usage.json |
| Label | `<email or "Codex"> (<plan>)`, for example `owner@example.com (pro)`. The label contains the account email. It is fixed at connect or reconnect, not refreshed by collection | codex/index.ts:230, core/lifecycle.ts:316 |
| Reconnect | `cli_login` or `import` again; identity must match | core/lifecycle.ts:296-319 |

### 1.2 Metrics emitted

Source: `metricsFrom` (codex/index.ts:511-555) and `resetInventoryMetric` (codex/index.ts:557-566).

| providerMetricKey | kind | unit | scope | windowStart/End | resetsAt | unlimited | Value format | Omitted when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rate_limit.primary_window` | quota_percentage | percent | `window:<limit_window_seconds>s`, or `window` if seconds missing | never set | `reset_at * 1000`; `reset_after_seconds` is ignored, so null if `reset_at` missing | no | used percent, 0-100, raw `String(used_percent)`, for example `"16"`, `"23.5"` | window is null or absent (plan has one window) |
| `rate_limit.secondary_window` | quota_percentage | percent | as above | never | as above | no | as above | null on the validated Pro account (codex/fixtures/usage-live-shape.json:11-12) |
| `additional.<name>.primary_window` | quota_percentage | percent | as above | never | as above | no | as above | `additional_rate_limits` is null or empty. `<name>` is `limit_name`, else `metered_feature`, else `additional`; not sanitized, so it can contain dots and spaces |
| `additional.<name>.secondary_window` | quota_percentage | percent | as above | never | as above | no | as above | as above |
| `credits.balance` | credits | `codex_credits` | `account` | never | never | yes: `credits.unlimited` (default false) | decimal string from number or string, for example `"1234.5678"` | whole `credits` object absent. Present but no `balance` and not unlimited gives availability `unknown`, value null |
| `reset_credits.available_count` | reset_inventory | `resets` | `account` | never | never | no | integer string | no count in either the reset-credits body or the usage body |

Availability: a window with `used_percent` missing is `unknown` with null value, not zero (codex/index.ts:206, test codex/index.test.ts:250-264). All other emitted rows are `available`.

Reset-time semantic: `resetsAt` is the instant the window renews. There is no window start, so elapsed share must be derived from the scope seconds (`window:18000s` is 5 hours, `window:604800s` is 7 days). Seen windows: 604800 (live shape), 18000 and 604800 (fixture).

### 1.3 Reset credits

Rows exist when the detail route answers (codex/index.ts:285-302). Source `GET wham/rate-limit-reset-credits`.

| Field | Value |
| --- | --- |
| `providerCreditId` | provider `id`, else `credit-<index>` |
| `eligible` and `usable` | both `true` when `status` is absent or `available`, both `false` otherwise (the fixture's `cooldown` is false). They are always equal |
| `expiresAt` | `expires_at`; numbers above 1e12 are ms, smaller numbers are seconds, strings are parsed as dates (codex/index.ts:593-598) |
| `cooldownUntil` | never set. Always null |
| `rawLabel` | `"<title or reset_type>, <status>"` with missing parts dropped, for example `available`; null if both missing |

If the detail route fails, no credit rows are written, the count metric still comes from the usage body, and a failure is recorded (section 1.5).

Action: `supportedActions = ["consume_reset_credit"]` (codex/index.ts:398). The detail response returns `actions: { enabled, supported: ["consume_reset_credit"] }` (server/routes/connections.ts:112-115). Gates, all enforced by the server (core/services/actions.ts:92-103, 171-177):

1. The owner's "Allow Account Actions" setting (default off). `actions.enabled` tells the UI.
2. Request body has the literal `confirm: true`.
3. Connection state is `ready` or `partial`.
4. A `creditId` is given, is in the latest snapshot and has `usable: true`.
5. The route is validated only against fakes. The provider route is source-inspected and unvalidated; the owner runs the first consume (docs/architecture/data-model.md:81).

Results come back as `action.state`: `succeeded`, `failed`, `uncertain` (request may have left, no retry).

### 1.4 Capabilities recorded (codex/index.ts:235-270)

| metricOrAction | availability | interface | evidence | reason |
| --- | --- | --- | --- | --- |
| `rate_limit.primary_window` | available | private | validated | none |
| `rate_limit.secondary_window` | available | private | source_inspected | null on the validated Pro account, which has one window |
| `additional_rate_limits` | available | private | source_inspected | present only with model-specific limits |
| `credits` | available | private | validated | none |
| `reset_credits` | available | private | validated | count read from the usage body; detail route is best effort |
| `reset_credits.consume` | available | private | source_inspected | owner-triggered only, behind the flag; unvalidated until the owner runs one |

No `unsupported` or `not_authorized` rows. Capabilities are written once at connect time (core/services/connect.ts:274-275), never on later collections, so they do not change when the account changes.

### 1.5 Errors and partial

- `partial`: usage body parsed but a window or `credits` lacks its value (availability `unknown`), or the reset-credits detail route failed with any status (failure is demoted to class `capability` if it was definitive; codex/index.ts:306-314).
- `reconnect_required`: usage returns 401 (`authentication_required`), refresh answers 400/401 or an `invalid_grant`-style code (`refresh_rejected`), or the retry after refresh still fails (`token_rejected`).
- Not a state change: 403 (`permission_denied`), 429 (`rate_limited`, honours `Retry-After`, default 60 s), 5xx, malformed usage body (`invalid_response`).
- Unknown shows as: null `valueText` with `unknown`.
- Not collected although present in the live shape: `code_review_rate_limit`, `chatpass.windows`, `credits.approx_local_messages`, `approx_cloud_messages`, `spend_control`, `model_usage`, `rate_limit_reset_credits.applicable_available_count`, `allowed`, `limit_reached`.

## 2. Claude

### 2.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `cli_login` (user opens an authorize URL, pastes the code or redirect URL; the step kind is `paste_redirect`, the stored method stays `cli_login`), `import` (paste `.credentials.json`) | claude/index.ts:139, 176-189 |
| Scope | `individual` in practice (client default) | server/routes/attempts.ts:18 |
| Interface | `private`. Connector is off by default; the owner enables it | claude/index.ts:138, claude/endpoints.ts:4 |
| Plan names observable | `subscriptionType` from the credentials file, free-form string, placed in the label. Docs name Pro and Max | claude/schemas.ts:13, claude/index.ts:247 |
| Label | `<profile email or "Claude"> (<subscriptionType>)`. Contains the email. `workspaceId` is the organization uuid (not shown) | claude/index.ts:248-255 |

### 2.2 Metrics emitted

Source: `metricsFrom` (claude/index.ts:364-455).

| providerMetricKey | kind | unit | scope | windowStart/End | resetsAt | unlimited | Value format | Omitted when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `five_hour` | quota_percentage | percent | `window:18000s` | never | `resets_at` ISO string, null if missing | no | raw `String(utilization)`, 0-100, may carry decimals (`"41.5"`) | key absent or the bucket is null |
| `seven_day` | quota_percentage | percent | `window:604800s` | never | as above | no | as above | as above |
| `seven_day_sonnet` | quota_percentage | percent | `window:604800s` | never | as above | no | as above | null on the live account (claude/fixtures/usage-live-shape.json:19) |
| `limits.<display_name>` | quota_percentage | percent | `window:604800s` | never | `resets_at` of the limit | no | raw `String(percent)` | only entries with `kind == "weekly_scoped"`; `<display_name>` is `scope.model.display_name`, else `scoped`. Other kinds (`session`, `weekly_all`, unknown) are ignored. No sanitizing, no dedupe |
| `extra_usage.used` | spend | USD | `month` | never | never | no | cents divided by 100, 2 decimals, `"12.50"` | `extra_usage.is_enabled` is not exactly true (disabled gives no row and no partial) |
| `extra_usage.monthly_limit` | spending_cap | USD | `month` | never | never | no | 2 decimals | extra usage disabled, or limit null, 0 or absent (no cap) |
| `reset_grants.available` | reset_inventory | `resets` | `account` | never | never | no | integer string; sum of `resets_left` over grants | `cedar_ember` null or absent, or `eligible` not true (the Claude Code sign-in gets `ineligible_reason: "surface"`, so the count is unknown, not zero) |

Availability: bucket object without `utilization` is `unknown` with null value; `extra_usage.used` with null `used_credits` while enabled is `unknown`. Everything else `available`.

Overlap: `seven_day_sonnet` and `limits.Sonnet` can describe the same bucket; `limits.<name>` and `seven_day` overlap by design. Never add them (docs/architecture/data-model.md:59).

Edge to design for (read from code, not covered by a test): `limits[].percent` may be JSON null per the schema (claude/schemas.ts:61). The code maps only `undefined` to null (claude/index.ts:396), so a null percent becomes `valueText: "null"`, `valueNum: null`, availability `available`. Guard against non-numeric `valueText`.

The `seven_day_breakdown.rows` (per surface: Claude Code, Chats, Cowork, Other) and the `spend` block exist on the live response and are not collected (docs/providers/claude.md evidence table).

### 2.3 Reset credits

Rows come from `cedar_ember.grants` (claude/index.ts:429-453):

| Field | Value |
| --- | --- |
| `providerCreditId` | `grant-<index>` (not stable across responses) |
| `eligible` | `cedar_ember.eligible === true`, same for every grant |
| `usable` | `eligible && resets_left >= 1` |
| `expiresAt` | `ends_at`, null if absent |
| `cooldownUntil` | never set |
| `rawLabel` | `"<resets_left> left"` (missing counts as 0) |

No action: `supportedActions` is absent, so `actions.supported` is `[]`. Capability `reset_grants.redeem` is `unsupported`, reason "no documented action". Do not draw a button.

### 2.4 Capabilities recorded (claude/index.ts:258-287)

| metricOrAction | availability | evidence | reason |
| --- | --- | --- | --- |
| `five_hour` | available | validated | none |
| `seven_day` | available | validated | none |
| `limits.weekly_scoped` | available | validated | none |
| `extra_usage` | available | source_inspected | collected while extra usage is switched on |
| `reset_grants` | available | validated | count validated; grant element shape source-inspected |
| `reset_grants.redeem` | unsupported | source_inspected | no documented action |

All `private`. No `not_authorized`.

### 2.5 Errors and partial

- `failures` is always empty (claude/index.ts:298). `partial` happens only when a bucket has no `utilization` or `extra_usage.used` has no amount.
- `reconnect_required`: usage 401, refresh 400/401/403.
- Not a state change: 403 on usage (`permission_denied`), 429 (`Retry-After`, default 60 s), 5xx, shape drift.
- Disabled extra usage is a normal `ready` state with no spend rows.

## 3. Grok

### 3.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `cli_login` (device code), `import` (paste `auth.json`) | grok/index.ts:130 |
| Scope | `individual` in practice | server/routes/attempts.ts:18 |
| Interface | `private` | grok/index.ts:129 |
| Plan names observable | `subscription_tier_display` from `/v1/settings`, free-form (test uses `SuperGrok`). Fetched at connect only, best effort, may be absent | grok/index.ts:398-408, grok/schemas.ts:64-66 |
| Label | `<email or "Grok"> (<tier>)`; tier part is dropped if the settings call failed | grok/index.ts:222 |
| Team or business logins | billing answers 412; see 3.5 | grok/index.ts:253-265 |

### 3.2 Metrics emitted

Source: grok/index.ts:249-330, `poolMetric` at 410-428. Response is proto-JSON, so zero values are omitted by the provider and the connector treats an absent percent as a real `0`.

| providerMetricKey | kind | unit | scope | windowStart/End | resetsAt | unlimited | Value format | Omitted when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `weekly_pool.used_percent` | quota_percentage | percent | `window:weekly` | both set from `currentPeriod.start/end` | `currentPeriod.end` | no | raw string; absent `creditUsagePercent` becomes `"0"` | never omitted. Non-weekly `currentPeriod.type` gives null value, availability `unsupported`. A 412 gives null value, availability `not_authorized` and no window |
| `on_demand_cap` | spending_cap | `grok_credits` | `account` | never | never | no | `String(onDemandCap.val)`; absent means `"0"` (disabled) | not emitted on a 412 |
| `on_demand.used` | spend | `grok_credits` | `window:weekly` | both set | never | no | `String(val)` | `onDemandUsed` absent. Present without `val` gives `unknown` |
| `prepaid_balance` | credits | `grok_credits` | `account` | never | never | no | `String(val)` | `prepaidBalance` absent. Present without `val` gives `unknown` |
| `product.<key>.used_percent` | quota_percentage | percent | `window:weekly` | both set | `currentPeriod.end` | no | raw string of `usagePercent` | no `productUsage`. `<key>` is the provider `product` with every run of characters outside `A-Za-z0-9_-` replaced by one `_` (grok/index.ts:314); an empty result is skipped. Seen: `grok_code`, `grok_chat`. Percent missing gives `unknown` |

The product rows are shares of the same weekly pool, not separate pools. The pool percent and the product percents use the same window. `grok_credits` has no documented dollar or token equivalence; label it "credits" only.

### 3.3 Reset credits

None. No `reset_credits` rows, no reset metric. Capability `reset_credits` is `unsupported`, reason "no route known". No actions.

### 3.4 Capabilities recorded (grok/index.ts:227-247)

| metricOrAction | availability | evidence | reason |
| --- | --- | --- | --- |
| `weekly_pool`, `product_usage`, `on_demand_cap`, `on_demand_used`, `prepaid_balance`, `plan` | available | validated | none |
| `reset_credits` | unsupported | source_inspected | no route known |

Note the capability names (`weekly_pool`, `on_demand_used`, `plan`) differ from the metric keys (`weekly_pool.used_percent`, `on_demand.used`). `plan` is not a metric; the plan lives only in the connection label. All `private`.

### 3.5 Errors and partial

- 412 from billing (team or business principal): one metric `weekly_pool.used_percent` with `not_authorized`, null value, plus a `permission_denied` capability failure. The run is `partial`, the connection `partial`, and nothing else is shown (grok/index.ts:253-265, test grok/index.test.ts:210-228). This is an account shape, not an error to fix.
- Non-weekly period: pool is `unsupported`, so the connection is `partial`; `on_demand_cap` and the rest still appear.
- `reconnect_required`: billing 401, refresh 400/401/403.
- Not a state change: 403 (`permission_denied`, differs from docs, see section 12), 429 (60 s), 5xx, shape drift.
- Not collected: legacy monthly meter, `topUpMethod`, `isUnifiedBillingUser`, `billingPeriodStart/End` duplicates.

## 4. Antigravity

### 4.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `paste_redirect` only (Google sign-in, user pastes the redirected localhost URL or code) | antigravity/index.ts:138, 144-149 |
| Scope | `individual` in practice | |
| Interface | `private` | antigravity/index.ts:137 |
| Plan names observable | `paidTier.name`, else `currentTier.name` from `loadCodeAssist`; free-form. Docs mention a free "Starter Quota" account | antigravity/index.ts:129 |
| Label | `<email or "Antigravity"> (<tier>)`; tier dropped if lookup failed | antigravity/index.ts:254 |
| Disconnect | tries Google token revocation, so `revocation` can be `revoked` | antigravity/index.ts:382-395 |

### 4.2 Metrics emitted

Source: antigravity/index.ts:279-317, known ids in antigravity/endpoints.ts:50-55.

| providerMetricKey | kind | unit | scope | windowStart/End | resetsAt | unlimited | Value format | Omitted when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `quota.gemini-5h` | quota_percentage | percent | `window:18000s` | never | `resetTime`, null if absent | no | used percent = `(1 - remainingFraction) * 100`, always 2 decimals, `"25.00"` | bucket not reported by the tier |
| `quota.gemini-weekly` | quota_percentage | percent | `window:604800s` | never | as above | no | as above | as above; free tier reports only the weekly buckets |
| `quota.3p-5h` | quota_percentage | percent | `window:18000s` | never | as above | no | as above | as above |
| `quota.3p-weekly` | quota_percentage | percent | `window:604800s` | never | as above | no | as above | as above |
| `quota.<other id>` | quota_percentage | percent | `window` (length unknown) | never | as above | no | as above | first occurrence of a `bucketId` wins; duplicates are dropped. Buckets without an id are dropped |

Naming: `3p` means third-party models (Claude and GPT) and `gemini` means the Gemini pool; the connector's own label strings ("Gemini five-hour", "Claude and GPT weekly") are defined but never emitted (antigravity/endpoints.ts:50-55, unused in index.ts). The summary reports a group name and a `displayName` per bucket in the live response (docs/providers/antigravity.md), but the schema drops both (antigravity/schemas.ts:24-35). Labels must come from the designer's map.

`remainingFraction` missing gives `unknown` with null value. A summary with zero buckets gives zero metrics and a `ready` connection.

### 4.3 Reset credits

None. No reset rows, no actions.

### 4.4 Capabilities recorded (antigravity/index.ts:261-277)

| metricOrAction | availability | evidence | reason |
| --- | --- | --- | --- |
| `quota.gemini-5h`, `quota.3p-5h`, `quota.3p-weekly` | available | source_inspected | present when the account's tier reports this window |
| `quota.gemini-weekly` | available | validated | same |
| `credits` | unknown | source_inspected | no validated source |

All `private`. The four quota rows say `available` even when the tier does not report them; the capability is not a guarantee a metric row exists. `credits` has no metric: do not show a credits balance.

### 4.5 Errors and partial

- `reconnect_required`: any Cloud Code call 401, refresh 400/401.
- Not a state change: 403 (`permission_denied`, also when `loadCodeAssist` returns no project), 429 (60 s), every host failing (`provider_unavailable`), shape drift.
- Host failover: a 5xx or network error moves to the second host before failing.
- `partial` only when a bucket has no `remainingFraction`.

## 5. Copilot

### 5.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `device_code` (GitHub device flow, `read:user`), `import` (paste `apps.json`) | copilot/index.ts:78 |
| Scope | `individual` in practice. Org billing is a separate, unbuilt `organization` connection | copilot/index.ts:246-251 |
| Interface | `private` | copilot/index.ts:77 |
| Plan names observable | `copilot_plan` is parsed (copilot/schemas.ts:41) and never emitted. Fixtures show `individual`, `business`, `pro`. The UI cannot show the plan |
| Label | `<github login> (Copilot)`. Contains the login | copilot/index.ts:230 |
| Token | not refreshable, no expiry, so no `refresh_rejected` path | copilot/index.ts:265-268 |

### 5.2 Metrics emitted

Source: copilot/index.ts:279-365. All rows share `resetsAt = quota_reset_date` parsed as a UTC date (for example `2026-11-01` becomes midnight UTC), `null` if absent. No windowStart/End anywhere. All scope `month`.

| providerMetricKey | kind | unit | unlimited | Value format | Availability rule |
| --- | --- | --- | --- | --- | --- |
| `credits.used_percent` | quota_percentage | percent | `premium_interactions.unlimited ?? false` | `100 - percent_remaining`, rounded to 2 decimals, for example `"0.4"` | always emitted. Has a pool when entitlement > 0 and not unlimited: `available` with value, or `unknown` if `percent_remaining` missing. Unlimited: `available`, null value, `unlimited: true`. No pool (entitlement 0, as on an org-managed seat): `unsupported`, null. `premium_interactions` absent: `unknown` |
| `credits.used_count` | absolute_quota | `credits` | no | `String(credits_used)` | emitted only if `credits_used` is present; `available` |
| `extra_usage.count` | absolute_quota | `credits` | no | `String(overage_count)` | always emitted. With a pool: `available` or `unknown` if count missing. Without a pool: `unsupported`, null |
| `chat.used` | absolute_quota | `requests` | true when `unlimited` or `entitlement == -1` | `entitlement - remaining` | always emitted. Unlimited: `available`, null value. Used computable: `available`. Snapshot absent or fields missing: `unknown` |
| `completions.used` | absolute_quota | `requests` | same | same | same |

Hard limits of this data: the entitlement (the "of N") and the remaining count are not emitted for any bucket, only used and percent. A "x of y requests" display is impossible. `credits.used_count` and `extra_usage.count` use unit `credits`, which is a plain count here, not a money or balance figure. There is no dollar value.

Shapes seen: individual paid plan (live shape, 5 rows, pool 200 entitlement, chat and completions unlimited); org-managed seat (`premium_interactions.entitlement` 0, `credits_used` present, chat and completions with real counts; fixture copilot/fixtures/usage-org-seat.json).

### 5.3 Reset credits

None. No rows, no actions. The quota reset date is the only reset information.

### 5.4 Capabilities recorded (copilot/index.ts:235-253)

| metricOrAction | availability | evidence | reason |
| --- | --- | --- | --- |
| `credits`, `extra_usage`, `chat`, `completions` | available | validated | none |
| `organization_billing` | unsupported | source_inspected | separate organization connection, not built yet |

All `private`. These names do not match the metric keys.

### 5.5 Errors and partial

- An org-managed seat is permanently `partial`: `credits.used_percent` and `extra_usage.count` are `unsupported`. Design the partial state for "this is the shape of the account", not "something broke".
- `reconnect_required`: usage 401 only.
- Every 403 without a `Retry-After` header is classified `rate_limited` (60 s), because `Number(null)` is 0 and passes the finite check (copilot/index.ts:380-381). `permission_denied` is unreachable. It never changes state.
- 429 (60 s), 5xx, shape drift: no state change.

## 6. Cursor

### 6.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `approval_poll` (open a URL, approve in the browser, Headroom polls) | cursor/index.ts:69, 75-80 |
| Scope | `individual` in practice, although docs call this a `member` connection. No code path sets `member` or `team_admin` | docs/providers/cursor.md; server/routes/attempts.ts:18 |
| Interface | `private` | cursor/index.ts:68 |
| Plan names observable | `membershipType` is parsed (cursor/schemas.ts:44) and never emitted; fixture value `pro`. The UI cannot show the plan |
| Label | the token's email claim, else `Cursor` | cursor/index.ts:144 |
| Admin API key | not built (capability `team_admin` is `unsupported`) | cursor/index.ts:160-165 |

### 6.2 Metrics emitted

Source: cursor/index.ts:253-320. Money fields arrive in cents and become 2-decimal USD strings. Cycle bounds arrive as epoch-ms strings (or ISO) and become numbers (cursor/index.ts:245-251).

| providerMetricKey | kind | unit | scope | windowStart/End | resetsAt | unlimited | Value format | Omitted when |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `included.total_percent` | quota_percentage | percent | `billing_cycle` | both set (cycle start and end) | cycle end | `isUnlimited ?? false` | rounded to 2 decimals then `String`, so `"17"`, `"6.48"`, `"62.5"` (API sends float noise such as 6.4750000000000005) | never omitted |
| `included.auto_percent` | quota_percentage | percent | `billing_cycle` | both set | cycle end | same | same | never omitted |
| `included.api_percent` | quota_percentage | percent | `billing_cycle` | both set | cycle end | same | same | never omitted |
| `included.limit` | spending_cap | USD | `billing_cycle` | both set | never | no | cents/100, 2 decimals, `"20.00"` | `planUsage.limit` null or absent |
| `on_demand.used` | spend | USD | `on_demand:<limitType>`, for example `on_demand:user`; bare `on_demand` if no type | both set | never | no | cents/100, `"0.00"`; uses `individualUsed`, else `pooledUsed` | never omitted. Null amount gives `unknown` |
| `on_demand.limit` | spending_cap | USD | same as `on_demand.used` | never set | never | no | cents/100 | `individualLimit` and `pooledLimit` both null or absent |

Availability on the three percent rows: `enabled === false` makes them `unsupported` even when a value is present; a null or absent value is `unknown`.

Naming caveat: `included.limit` is the plan's included allowance in USD but carries kind `spending_cap`, which the data model reserves for on-demand caps (docs/architecture/data-model.md:54). Treat it as "included allowance", not as an on-demand cap. It is also the only bound for the included pool in dollars: spent-so-far (`totalSpend`, `includedSpend`, `bonusSpend`, `remaining`) is parsed in the fixture but not emitted. The percent rows are the only included-usage meters. `autoPercentUsed` and `apiPercentUsed` are separate pools, not parts of a sum that must reach the total.

### 6.3 Reset credits

None. The billing cycle end is the reset. No actions.

### 6.4 Capabilities recorded (cursor/index.ts:149-167)

| metricOrAction | availability | evidence | reason |
| --- | --- | --- | --- |
| `included.total_percent`, `included.auto_percent`, `included.api_percent`, `on_demand` | available | validated | none |
| `team_admin` | unsupported | source_inspected | admin API key connection not built yet |

All `private`. `on_demand` maps to the two on-demand metric keys; `included.limit` has no capability row.

### 6.5 Errors and partial

- `reconnect_required`: usage 401, refresh 400/401/403.
- Not a state change: 403, 429 (60 s), 5xx, shape drift.
- `partial` when a percent is null (`unknown`), when `enabled === false` (three `unsupported` rows), or when the on-demand amount is null.

## 7. Vercel AI Gateway

Directory is `packages/connectors/vercel-ai-gateway`. It has no `schemas.ts` and its `src/fixtures/` folder is empty; tests build responses inline (vercel-ai-gateway/index.test.ts:55-97). The Vercel SDK performs the HTTP calls.

### 7.1 Connection

| Item | Value | Source |
| --- | --- | --- |
| Auth methods | `api_key` (paste a Gateway key) | vercel-ai-gateway/index.ts:60, 62-71 |
| Scope | `individual` in practice. A key belongs to one team, but no team is recorded | |
| Interface | `official` (the only official connector). Metrics are `official` | vercel-ai-gateway/index.ts:59 |
| Plan names observable | none | |
| Label | constant `Vercel AI Gateway`. Two Gateway connections have identical labels; identity is a hash of the key, assurance `weak` | vercel-ai-gateway/index.ts:99-109 |
| Token | not refreshable | |

### 7.2 Metrics emitted

Source: vercel-ai-gateway/index.ts:125-197. Scope string `team` is a metric scope, not a connection scope. No `resetsAt` on any row.

| providerMetricKey | kind | unit | scope | windowStart/End | unlimited | Value format | Omitted when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `credits.balance` | credits | `gateway_credits` | `team` | never | no | decimal string from the SDK, for example `"12.50"` | never; if the credits call fails the whole collection fails |
| `credits.total_used` | credits | `gateway_credits` | `team` | never | no | decimal string | same |
| `spend.<N>d` (default `spend.30d`) | spend | USD | `team` | start set to now minus N days, end set to now (a rolling window, not a billing period) | no | sum of daily `totalCost`, 6 decimals, `"1.750000"` | never omitted. Success is `available`. Failure keeps the row with null value: availability `not_authorized` for every failure except a rate limit, which is `temporarily_unavailable` |

There is no reset or renewal time and no allowance. `balance` is a remaining prepaid amount and `total_used` is a lifetime total; neither is a share of a limit, so draw numbers, not bars. Do not label `gateway_credits` as dollars. Spend without a Pro or Enterprise plan is `not_authorized` with a null value.

### 7.3 Reset credits

None. No actions.

### 7.4 Capabilities recorded (vercel-ai-gateway/index.ts:111-123)

| metricOrAction | availability | interface | evidence | reason |
| --- | --- | --- | --- | --- |
| `credits.balance` | available | official | documented | none |
| `credits.total_used` | available | official | documented | none |
| `spend.report` | unknown | official | documented | Pro and Enterprise plans only; probed on each collection |

The `spend.report` capability stays `unknown` forever (written once at connect). The live signal is the `spend.<N>d` metric row.

### 7.5 Errors and partial

- A key without spend access is permanently `partial` (spend row `not_authorized`, plus a `permission_denied` failure). Common on non-Pro plans. Design for it.
- `reconnect_required`: 401 on credits (`authentication_required`). A 403 on credits is `permission_denied`, which does not change state.
- Credits response shape drift gives `invalid_response` (credits fields must be strings).
- 429 is `rate_limited` (60 s); other non-401/403/429 failures of the spend call keep the connection `partial`.

## 8. API shapes the UI receives

Epoch milliseconds everywhere. Auth is a session cookie. Routes under `/api` (server/app.ts:90-92): `GET /providers`, `GET /connections`, `GET /connections/:id`, `POST /connections/:id/{actions,reconnect,pause,refresh}`, `DELETE /connections/:id`, `/attempts/...`. There is no route to list snapshots or metrics over time.

### 8.1 Types the web client parses (web/api.ts:59-133)

| Field | Type | List `ConnectionSummary` | Detail `connection` | Detail elsewhere |
| --- | --- | --- | --- | --- |
| `id` | string | yes | yes | |
| `provider` | one of the seven provider names | yes | yes | |
| `label` | string (contains email or login for most providers) | yes | yes | |
| `scope` | `individual` `member` `team_admin` `organization` | yes | yes | |
| `state` | `ready` `partial` `reconnect_required` `paused` | yes | yes | |
| `reconnectReason` | `refresh_rejected` `token_rejected` `identity_changed` `revoked_by_owner` or null | yes | yes | |
| `interface` | `official` or `private` | yes | yes | |
| `authMethod` | `cli_login` `device_code` `paste_redirect` `approval_poll` `api_key` `import` | yes | yes | |
| `lastSuccessAt` | number or null | yes | yes | |
| `stale` | boolean | yes | no | |
| `latestRun` | list: `{ startedAt: number, outcome: string, error: string or null }` | yes | no | detail has its own `latestRun`: `{ startedAt, outcome: string or null, sanitizedError: string or null }`; the server also sends `finishedAt` but the web type drops it |
| `metricCount` | number | yes | no | |
| `capabilities[]` | `{ metricOrAction, availability, interface, evidenceLevel, reason?: string or null }` | no | | detail only. Wire also sends `checkedAt` (ms), not in the web type |
| `snapshot` | `{ observedAt, receivedAt, connectorVersion, metrics[], resetCredits[] }` or null | no | | detail only; null until a run produced observations |
| `snapshot.metrics[]` | `{ providerMetricKey, kind, scope, valueText: string or null, valueNum: number or null, unit, unlimited?: boolean, windowStart: number or null, windowEnd: number or null, resetsAt: number or null, availability, interface }` | no | | detail only. Order is unspecified (no `ORDER BY`, core/snapshots.ts:139-143); sort in the UI |
| `snapshot.resetCredits[]` | `{ providerCreditId, eligible, usable, expiresAt: number or null, cooldownUntil: number or null, rawLabel: string or null }` | no | | detail only. Order unspecified |
| `actions` | `{ enabled: boolean, supported: ["consume_reset_credit"] or [] }` | no | | detail only. Only Codex has a non-empty `supported` |

Wire fields the typed client drops: detail `connection` is built by spreading the stored row (server/routes/connections.ts:61-66), so the JSON also carries `providerAccountId`, `workspaceId`, `connectorVersion`, `createdAt`, `updatedAt`. These include personal identifiers. Design only from the table above.

`GET /providers` returns `{ provider, version, interface, methods[] }` for enabled connectors only (server/routes/providers.ts:9-16). The default enabled set is `codex` only (core/config.ts:49-57), so another provider appears only when the owner enables it.

Action result (`POST /:id/actions`, web/api.ts:135-147): `{ action: { id, action, state: requested|submitted|succeeded|failed|uncertain, requestedAt, completedAt, providerReference, sanitizedError }, state }`. The server also sends `collection`, which the web type ignores. Error bodies: `actions_disabled` (403), `not_confirmed` (400), `unsupported_action` (400), `action_not_allowed` with a reason `connection_not_ready`, `credit_not_usable` or `credit_required` (409) (server/routes/errors.ts).

Other responses: `refresh` returns `{ outcome, state }`; `pause` returns `{ state }`; `DELETE` returns `{ revocation: revoked|local_only|failed }` (Antigravity can be `revoked`; all others are `local_only`).

### 8.2 Known mismatches in the response contract

- The list schema says `latestRun.outcome` is a non-null string (web/api.ts:59-63). The database column is null while a run is in flight or if the process died mid-run (core/db/schema.ts:126, core/snapshots.ts:27-31). The server returns that null in the list, so the list parse would fail for that moment. Plan for a nullable outcome.
- The first collection after a successful connect that fails non-definitively sets `state: partial` and `lastSuccessAt: now` with no snapshot (core/services/connect.ts:295-296). A connection can have `lastSuccessAt` set and `snapshot: null`.

## 9. Connection states, staleness and runs

### 9.1 Connection states

| State | Set when | UI meaning |
| --- | --- | --- |
| `ready` | created or reconnected; last collection had zero failures and every metric `available`; also set when the owner un-pauses, whatever the state before (core/lifecycle.ts:344-352) | Normal. Show data |
| `partial` | last collection had at least one failure, or at least one metric whose availability is not `available`; or the first collection after connect failed non-definitively (core/services/collect.ts:129-136, connect.ts:278-296) | Some metrics missing or unsupported for this account. The snapshot is valid. Show what is missing and why (metric availability plus latest run error). It can be permanent (Grok 412, Copilot org seat, Vercel without Pro, Cursor `enabled: false`) |
| `reconnect_required` | a definitive failure: usage 401 (`authentication_required`) gives `token_rejected`; a refresh rejection gives `refresh_rejected` (core/services/collect.ts:101-125, 172-174, 181-193). Collection is skipped afterwards (collect.ts:56-58). The old snapshot stays | Credentials are dead. Show Reconnect (`POST /:id/reconnect` with a method from `/providers`; 409 unless this state). Keep the last snapshot visible, dimmed, with its age |
| `paused` | owner paused. The scheduler skips it (server/scheduler.ts:53). Cannot pause a `reconnect_required` connection (lifecycle.ts:346) | Not refreshing. The snapshot ages and can go stale |

`reconnectReason` values:

| Value | Reachable in code | Meaning |
| --- | --- | --- |
| `refresh_rejected` | yes | The provider refused the refresh token |
| `token_rejected` | yes | The access token was refused and refresh was impossible or failed on retry |
| `identity_changed` | no. Only set by `applyFailure`, which nothing calls (core/lifecycle.ts:362-367) | Enum only. A connect-time identity mismatch fails the attempt instead |
| `revoked_by_owner` | no | Enum only |

Non-definitive failures (`rate_limited`, `provider_unavailable`, `internal_error`, `permission_denied`, `invalid_response`, `unsupported_metric`, `selection_required`) leave the connection state unchanged. A `ready` connection can therefore have a failing latest run; only `latestRun` and `stale` reveal it. After a `rate_limited` run the scheduler waits for `retryAfter` before the next try (server/scheduler.ts:73).

### 9.2 `stale`

`stale = lastSuccessAt != null && now - lastSuccessAt > staleAfterSeconds * 1000`, computed on the list route only (server/routes/connections.ts:34-45). Default `staleAfterSeconds` is 12 hours, minimum 60 s (core/config.ts:70-75). A connection that never succeeded is `stale: false`, so "never collected" is `lastSuccessAt: null`, not `stale`. `lastSuccessAt` is the observation time of the last `succeeded` or `partial` run (core/lifecycle.ts:327-333), which for these connectors is the collection time. The detail route has no `stale`; derive it from `lastSuccessAt` and the same threshold if needed (the threshold is not exposed to the client). The default collection interval is 15 minutes (`refreshIntervalSeconds` 900, plus up to 10 percent jitter), so a healthy account is far fresher than the 12 hour threshold. Failed runs never replace the snapshot; the prior `observedAt` stays (docs/architecture/data-model.md:69).

Two times per snapshot: `observedAt` (provider truth, in practice the collection time because connectors use their own clock) and `receivedAt` (when stored).

### 9.3 `syncRunOutcomes` and `latestRun`

| Outcome | Assigned when | Notes |
| --- | --- | --- |
| `succeeded` | collection returned with no failures and all metrics available | |
| `partial` | collection returned with failures or non-available metrics | `error` is null; the reason is in the metric rows |
| `rate_limited` | category `rate_limited` | error text `rate_limited: <message>`; scheduler honours `retryAfter` |
| `provider_unavailable` | `provider_unavailable` or `internal_error` | |
| `authentication_failed` | `authentication_required`, `identity_mismatch`, `approval_denied`, `approval_expired` | usually accompanies `reconnect_required` |
| `invalid_response` | `invalid_response`, `permission_denied`, `unsupported_metric`, `selection_required` | note that a 403 lands here |
| `interrupted` | never assigned in code (enum only) | |

`error` and `sanitizedError` have the form `<category>: <message>` and are safe to show (core/snapshots.ts:44). Messages are short, such as `usage returned 401`.

## 10. What is NOT available

Do not imply any of the following.

- History: no route lists snapshots or metrics over time. `SnapshotStore.history()` exists (core/snapshots.ts:152) and has no caller. Only the latest snapshot is returned. No sparklines, trends, deltas or burn-rate.
- Absolute token counts: none. Codex's `approx_local_messages` and `approx_cloud_messages` are not collected. No provider emits tokens.
- Absolute quota sizes ("x of y"): not emitted for any percent bucket. Copilot chat and completions give used only, not entitlement or remaining. Cursor gives percent plus an included USD limit, no used dollars.
- Per-model breakdowns: only what appears as a separate bucket (Claude `seven_day_sonnet` and `limits.<model>`, Codex `additional.<name>`, Grok `product.<key>`, Antigravity pool buckets). No per-model usage, no cost per model, no breakdown by surface (Claude's `seven_day_breakdown` is not collected).
- Plan or tier as data: only inside `label` for Codex, Claude, Grok and Antigravity, as free text fixed at connect. Copilot, Cursor and Vercel show no plan. Do not map a plan to an allowance.
- Reset times for: Claude extra usage, Codex credits, Grok caps, balances, Vercel credits and spend, Cursor on-demand and included limit. Reset rows exist only on window and Copilot rows.
- Reset inventory (banked resets): Codex (with detail rows and an action) and Claude (rows, no action). No other provider.
- Spend: Claude extra usage (when enabled), Cursor on-demand, Grok on-demand (credits), Vercel 30 day spend (Pro and Enterprise only). Codex, Copilot and Antigravity have no spend.
- Dollar balances: no provider emits a prepaid USD balance. `prepaid_balance` (Grok) and Vercel `credits.balance` are provider credits.
- Antigravity credits: capability `unknown`, no metric.
- Team or organization data: no connection is built with scope `team_admin`, `organization` or `member`. Copilot org billing, Cursor admin and Grok management API are not built.
- Multiple teams per Vercel key and team naming: not recorded.
- Alerts, thresholds, notifications: none exist (docs/product.md lists them as open).
- Capabilities do not update after connect, so they can disagree with the current metrics. Prefer metric rows.

## 11. Window vocabulary

Every `scope` string the connectors can emit. Scope describes the span a value covers; `resetsAt` and `windowStart/End` give the instants.

| Scope string | Emitted by | Span | Proposed label |
| --- | --- | --- | --- |
| `window:18000s` | Codex, Claude, Antigravity | 5 hours, rolling | 5-hour session |
| `window:604800s` | Codex, Claude, Antigravity | 7 days | Weekly |
| `window:<N>s` (other N) | Codex (any `limit_window_seconds`) | N seconds | Format N: whole hours under 48, else days (`window:86400s` is Daily) |
| `window` | Codex, Antigravity (length unknown) | unknown | Limit (no span shown; name from the key) |
| `window:weekly` | Grok (pool, product rows, on-demand spend) | the provider's weekly usage period; real bounds are in `windowStart/End` | Weekly |
| `month` | Claude extra usage, Copilot (all five rows) | the provider's monthly period; Copilot gives the reset date, Claude gives none | Monthly |
| `billing_cycle` | Cursor included rows | the billing cycle, with start and end | Billing cycle |
| `on_demand` | Cursor (no `limitType`) | the billing cycle, on-demand spend | On-demand |
| `on_demand:<limitType>` | Cursor; the only seen value is `user` | the billing cycle, on-demand | On-demand (personal) for `user`; unseen types print as On-demand and the type |
| `account` | Codex credits and reset count, Claude reset grants, Grok cap and prepaid | not time-bound | (no window label; a fact, not a window) |
| `team` | Vercel (all three rows) | the Gateway key's team; spend is a rolling N-day span via `windowStart/End` | Team (spend: Last 30 days) |

Window pairing: sessions are `window:18000s`, weekly is `window:604800s` or `window:weekly`. An account has either, both, or neither. Codex Pro has a weekly window only; Antigravity free tier has weekly only. Treat a missing 5-hour row as "not applicable", not as unknown.

Metric key to label map (suggested). Keys carry their own meaning where scope is shared:

| Key | Label |
| --- | --- |
| `rate_limit.primary_window`, `rate_limit.secondary_window` | Label by scope seconds (5-hour, Weekly); primary and secondary do not mean short and long |
| `additional.<name>.<slot>` | `<name>` limit, then by scope |
| `five_hour`, `seven_day` | 5-hour, Weekly |
| `seven_day_sonnet`, `limits.<name>` | Weekly, `<name>` only |
| `quota.gemini-*`, `quota.3p-*` | Gemini 5-hour or weekly; Claude and GPT 5-hour or weekly |
| `weekly_pool.used_percent` | Weekly pool |
| `product.<key>.used_percent` | `<key>` share of the weekly pool (prettify `grok_code` to Code) |
| `credits.used_percent` (Copilot) | AI credits used |
| `included.total_percent`, `.auto_percent`, `.api_percent` | Included usage; Auto pool; API pool |
| `credits.balance`, `credits.total_used` | Credit balance; Credits used |
| `extra_usage.*`, `on_demand.*` | Extra usage spend and cap; On-demand spend and cap |
| `reset_credits.available_count`, `reset_grants.available` | Resets available |

## 12. Unit vocabulary

| Unit | Used by (kind) | Value | Display rule |
| --- | --- | --- | --- |
| `percent` | all quota_percentage rows | decimal string, used share, 0-100 (not clamped by connectors) | Bar or arc filled to the value; show "N%" with at most 2 decimals; clamp the fill at 100 but show the true number; null or non-numeric text is unknown |
| `requests` | Copilot `chat.used`, `completions.used` (absolute_quota) | integer string, used count | "N requests used". No total. When `unlimited`, show "unlimited" with no number |
| `credits` | Copilot `credits.used_count`, `extra_usage.count` (absolute_quota) | integer or decimal string, a count | "N credits". Never a currency. Do not equate to `codex_credits` or `grok_credits` |
| `codex_credits` | Codex `credits.balance` (credits) | decimal string, up to 4 decimals | "N credits", remaining balance. `unlimited` shows "unlimited" |
| `grok_credits` | Grok `on_demand_cap` (spending_cap), `on_demand.used` (spend), `prepaid_balance` (credits) | integer-looking string | "N credits". `on_demand_cap` of `0` means on-demand is off; show "off", not "0 of cap" |
| `gateway_credits` | Vercel `credits.balance`, `credits.total_used` (credits) | decimal string, 2 decimals in tests | "N credits". Do not prefix with a dollar sign |
| `USD` | Claude `extra_usage.*`, Cursor `included.limit` and `on_demand.*`, Vercel `spend.<N>d` | decimal string: 2 decimals (Claude, Cursor), 6 decimals (Vercel) | Currency format with 2 decimals; Vercel may show more for tiny values |
| `resets` | `reset_credits.available_count`, `reset_grants.available` (reset_inventory) | non-negative integer string | A row of pips plus the count. Separate from the bucket's reset time. Claude shows `0` when not eligible, which is zero usable, not unknown |

Kind to display shape: `quota_percentage` is a meter; `absolute_quota` is a count; `credits` is a balance or lifetime total; `spend` is an amount over a span; `spending_cap` is a ceiling shown beside its spend row (`on_demand.used` next to `on_demand.limit`, `extra_usage.used` next to `extra_usage.monthly_limit`, except Cursor `included.limit`, which is the included allowance); `reset_inventory` is a count; `reset_timestamp` is declared in core/enums.ts:130 but no connector emits it, so the reset time of a bucket is its `resetsAt` field.

## 13. Metric keys per provider (compact)

- codex: `rate_limit.primary_window`, `rate_limit.secondary_window`, `additional.<name>.primary_window`, `additional.<name>.secondary_window`, `credits.balance`, `reset_credits.available_count`
- claude: `five_hour`, `seven_day`, `seven_day_sonnet`, `limits.<display_name>`, `extra_usage.used`, `extra_usage.monthly_limit`, `reset_grants.available`
- grok: `weekly_pool.used_percent`, `on_demand_cap`, `on_demand.used`, `prepaid_balance`, `product.<key>.used_percent`
- antigravity: `quota.gemini-5h`, `quota.gemini-weekly`, `quota.3p-5h`, `quota.3p-weekly`, `quota.<other>`
- copilot: `credits.used_percent`, `credits.used_count`, `extra_usage.count`, `chat.used`, `completions.used`
- cursor: `included.total_percent`, `included.auto_percent`, `included.api_percent`, `included.limit`, `on_demand.used`, `on_demand.limit`
- vercel_ai_gateway: `credits.balance`, `credits.total_used`, `spend.<N>d`

## 14. Contradictions between docs and code

Docs live in `docs/providers/*.md` and `docs/architecture/data-model.md`.

1. Cursor `included.limit` is the included allowance but has kind `spending_cap`, which data-model.md:54 reserves for on-demand caps separate from the included entitlement.
2. Codex docs use the field names `rate_limits` and `code_review_rate_limits` (codex.md metrics table). The code reads `rate_limit`, and emits no code-review bucket. The live shape has `code_review_rate_limit: null`.
3. Codex and Claude docs list the banked reset count as `unknown` and unvalidated in their metrics tables, while their evidence tables and the code record it as validated and available.
4. Codex docs describe a `device_code` fallback and Claude docs a direct PKCE fallback with method `paste_redirect`. Code supports only `cli_login` and `import` for both.
5. Grok docs say a missing weekly pool is `unknown`. Code marks it `unsupported` (non-weekly period) or `not_authorized` (412).
6. Grok docs say a 401 or 403 from billing gets one refresh then is definitive. Code treats 403 as `permission_denied`, which never changes state.
7. Grok docs describe a separate `api_key` management connection and omit `on_demand.used`, `prepaid_balance` and `product.*` from the metrics table; code has no such connection and emits those three metric groups.
8. Antigravity docs say each bucket carries `displayName` and `window`, and describe a legacy fallback endpoint. Code reads neither and has no fallback. `knownBuckets[].label` is defined and never used.
9. Copilot docs say plan name is available and the status column says "unknown until validated" for every metric. Code never emits the plan, and the evidence table says validated. Docs say reset is unknown; code sets `resetsAt` from `quota_reset_date`.
10. Cursor docs say the member connection has scope `member` and that plan is available. No code sets scope `member`, and `membershipType` is not emitted. Docs name `GetSandUsageStatus` as the primary RPC, while code and the validated evidence row use `GetCurrentPeriodUsage`.
11. Vercel docs say balances are stored with unit `credits`; code uses `gateway_credits`. Docs say a key resolving to several teams yields `select_account` and the team is recorded on the connection; code records only a key hash and a constant label. Docs say a 403 on credits is definitive; code treats it as `permission_denied` (no state change). Docs say an ineligible spend report is `unsupported` or `not_authorized`; code produces `not_authorized` or `temporarily_unavailable`.
12. Docs say capabilities describe what the account exposes; the code writes them once at connect, so they never reflect later changes (Vercel `spend.report` stays `unknown`).
13. data-model.md says reconnect reasons include `identity_changed` and `revoked_by_owner`; the collection path cannot set either.
14. data-model.md says a first-connect usage failure is `partial`; the code also stamps `lastSuccessAt` in that case, with no snapshot to show.

Code-level findings worth a ticket (not doc contradictions): Claude `limits[].percent: null` renders as `"null"` (section 2.2); Copilot 403 is always classified `rate_limited` (section 5.5); the list contract rejects a null `latestRun.outcome` (section 8.2); Codex ignores `reset_after_seconds`; `limits.<name>` keys in Claude are not deduplicated.
