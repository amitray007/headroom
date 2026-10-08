# To-do

Provider data that Headroom does not collect yet. Each item says what is known, why it waits and what to do next. Endpoint and field details live in the provider dossier; this list only tracks the open work. Remove an item when it ships or when the owner drops it.

## Claude Max monthly API credits (Console)

**What it is.** Max 5x includes $100 and Max 20x $200 of Claude API credit each billing cycle. The credit lands in the Console organization linked to the plan and expires at the end of the cycle. Anthropic shows it only under Console Settings > Billing > Promotional credits ([Claude dossier](providers/claude.md), source S9).

**What was tried on 2026-10-08.** Every token route answered 403:

| Route | Credential | Answer |
| --- | --- | --- |
| Admin API `GET /v1/organizations/cost_report` | API key | "Missing permissions": the Admin API is closed to individual Console organizations |
| `GET api.anthropic.com/api/oauth/organizations/{org}/prepaid/credits` | Keyless Console OAuth token | "This endpoint is only available for Pro and Max plans" |
| `GET platform.claude.com/api/organizations/{org}/prepaid/credits` | Same token | "This endpoint does not accept OAuth access tokens" |

**The only known route.** The Console's own endpoint `GET platform.claude.com/api/organizations/{console_org}/prepaid/credits` with the browser `sessionKey` cookie (and `lastActiveOrg`). Community tools that use it report `amount`, `next_expires_at` and `promo_tranches[]` with `granted_amount_minor_units`, `remaining_amount_minor_units` and `expires_at`. No tool shows this with a real Max grant.

**Why it waits.**
- The project rule is to never collect provider cookies. Reading this needs a decision entry that allows one read-only cookie for one endpoint.
- A browser extension was rejected: Headroom has no second surface.
- A headless sign-in on the server is heavy (Chromium, hCaptcha on the login page, no Google sign-in).

**Next steps, in order.**
1. In DevTools on the billing page, confirm that the `prepaid/credits` response carries the Max grant in `promo_tranches`. Record field names only.
2. Read the `sessionKey` cookie's expiry to learn how often the owner would paste it again.
3. Test once from the Dokploy host that platform.claude.com answers a server request with that cookie.
4. If all three pass and the owner agrees, write the decision entry, then add a "Console balance" step to the Claude account: a pasted cookie, one GET per collection, and `reconnect_required` when the cookie expires.

Until then, a cheaper option remains: show the plan allowance ("API credit $200 a month") from the plan tier, linked to the billing page.

## Claude free session resets (`juniper_tide`)

**What it is.** An experiment that gives free resets of the 5-hour session limit. Claude Code reads its status from `GET /api/oauth/usage?at_wall=1&skip_spend=1` only when the session limit is reached. The block has `eligible`, `ineligible_reason`, `in_experiment`, `arm` (`control` or `reset`), `available`, `next_available_at`, `weekly_resets_at` and `resets_per_week`. The plain usage read returns `null` (source-inspected in Claude Code 2.1.294; `null` on the owner's account on 2026-10-08).

**Why it waits.** The real shape has not been seen. The `at_wall` read may count the account into the experiment, so Headroom does not make it on a schedule.

**Next steps.**
1. The next time the owner hits a session limit, make one `at_wall` read with the owner's consent and record field names and types.
2. Decide when Headroom reads it: only while the session meter is at 100%, at most once per session window.
3. Show it as display only, in the panel footer beside the Reset Grant: "Free Session Reset available" or "Next free reset Oct 12".
4. Never call the claim endpoint (`POST /api/organizations/{org}/reset_rate_limits`). Redemption needs an explicit owner action under ADR 0003.

## Other Claude codename keys

The usage response carries keys that were all `null` on 2026-10-08: `amber_cistern`, `amber_gauge`, `amber_ladder`, `brass_thimble`, `cinder_cove`, `copper_kite`, `harbor_lantern`, `nimbus_quill`, `omelette_promotional`, `seven_day_omelette`, `tangelo`, `wattle_ember`. When one turns non-null, record its field names and types in the dossier, then decide whether it is a limit, a credit or a reset program before showing it.

## Claude credit top-ups in the Wallet

A rise in Claude usage credits raises a `top_up_detected` notice but adds no Wallet row, because the Wallet counts credits and this balance is USD. The `prepaid/credits` response separates purchased `tranches` from `promo_tranches`, so a rise could become a paid top-up with a price, or a free one. This needs a Wallet rule for money-denominated top-ups first.

## Claude weekly share by surface

`seven_day_breakdown.rows[].percent` gives the weekly share per surface (Claude Code, Chats, Cowork, Other). It is in the live response but not collected. It could become a breakdown under the Weekly meter.
