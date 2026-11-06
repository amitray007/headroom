# Kimi Code

Reviewed: 2026-11-06. This dossier covers Kimi Code subscription rate limits, not Moonshot Open Platform API balances.

## Scope and recommendation

Connect through Kimi Code’s browser device approval flow, selecting Global (`kimi.ai`) or Mainland China (`kimi.com`). One encrypted OAuth session supplies identity and the five-hour and weekly windows the account reports. Headroom refreshes the session directly over HTTPS. New connections require neither an API key nor a copied website token. Existing key-based connections remain readable until same-account browser Reconnect replaces them.

The owner removed monthly stats from scope after the approved Code session returned only session and weekly windows. Headroom does not collect or display Kimi monthly totals, Code shares, monthly placeholders or token-setup guidance, including from older cached snapshots. No membership website request or second credential is needed.

## Evidence status

| Claim | Status | Basis |
| --- | --- | --- |
| All Kimi Code keys and devices share subscription quotas; monthly totals are a separate membership constraint | documented | Membership benefits [S1, S2]; monthly stats are outside this connector's current scope |
| New plans omit weekly rate limits; legacy plans retain them | documented | Membership benefits [S1]; never invent an unreported window |
| `/coding/v1/me` supplies stable `user_id` and optional account label and plan | source-inspected | Official profile client [S3] |
| `/coding/v1/usages` returns `usages.limit_5h` and optional `limit_7d`; older responses carry count windows | source-inspected | Official usage clients [S4, S5] |
| Device authorization, polling and refresh use a public client id and regional OAuth hosts | source-inspected | Official region, OAuth and device-identity contracts [S6, S9–S11] |
| Browser approval may use the region's website origin rather than its OAuth origin | source-inspected | Official client and public CLI report [S9, S12] |
| The owner's browser connection completed and saved only session and weekly metrics | prior observation | Sanitized local connection metadata; no account ids, values, tokens or raw responses recorded |
| All plans, deployment environments, revocation and refresh rotation work live | unvalidated | Synthetic tests establish implementation behavior, not universal live access |

## Metrics

| Dashboard field | Availability | Source and interpretation | Notes and limit |
| --- | --- | --- | --- |
| Five-hour used percent and reset | `available` when returned | `usages.limit_5h`; legacy five-hour `limits[].detail` | `private`, source-inspected. `quota.five_hour`, scope `window:18000s` |
| Weekly used percent and reset | `available` when returned | `usages.limit_7d`; legacy `usage` | `private`, source-inspected. `quota.weekly`, scope `window:604800s`; omitted when not reported |
| Identity and plan | `available` when returned | `/me.user_id`, email/nickname and provider plan name | `private`, source-inspected; stable identity is `region:user_id` |
| Monthly stats, Extra Usage wallet, spend and reset inventory | Not collected | Outside the implemented read scope | No inferred allowances or zero balances |

Ratios become decimal percentages. Legacy percentages use `used / limit`, or `(limit - remaining) / limit` if `used` is absent. Numeric strings are accepted; empty strings, booleans, negatives and impossible counts are not. A malformed supported bucket becomes `unknown` with `invalid_response` while healthy buckets remain usable. A bad reset leaves the percentage intact. Missing supported windows and unrecognized fields, including monthly fields, are omitted.

## Connect workflow

1. The owner chooses Kimi Code's single browser sign-in method (`device_code`). New connections select their region; Reconnect keeps the stored region.
2. Headroom creates a per-attempt device id and requests device authorization. The browser sees only the approval URL and user code; the private device code stays in the encrypted attempt.
3. The owner approves on Kimi's website. Headroom polls at the provider interval, increases it on `slow_down`, respects `Retry-After`, and stops on denial, cancellation or expiry. Approval URLs must use the selected region's HTTPS website or OAuth origin, without URL credentials.
4. Access and refresh tokens are encrypted per connection. `/me` establishes identity, and collection checks that identity before reading `/usages` with the same access token.
5. Refresh uses the same region and device id. Rotated credentials are saved before use. Expiry comes from `expires_in`; definitive rejection requires browser Reconnect.
6. Same-account Reconnect preserves the connection id and history and replaces the complete credential, discarding old key/session fields. Disconnect deletes the local credential and returns `local_only`.

## APIs and tools

| Operation | Endpoint | Authentication and behavior |
| --- | --- | --- |
| Browser approval | `POST https://auth.kimi.ai/api/oauth/device_authorization` or the same path on `auth.kimi.com` | Form-encoded public client id `17e5f671-d194-4dfb-9706-5516cb48c098`; no account credential sent |
| Token and refresh | `POST https://auth.kimi.ai/api/oauth/token` or the same path on `auth.kimi.com` | Device-code or refresh-token grant; same private device identity and honest Headroom headers |
| Identity | `GET https://api.kimi.ai/coding/v1/me` or the same path on `api.kimi.com` | Bearer OAuth access token, or an older stored Code key |
| Usage | `GET https://api.kimi.ai/coding/v1/usages` or the same path on `api.kimi.com` | Same credential and region as identity; only session and weekly windows are collected |

Requests use the shared hard timeout and reject redirects. Credentials never cross regions. HTTP 401 receives the application's single refresh/retry path; 403 is `permission_denied`; 429 respects `Retry-After`; 5xx and transport failures are transient. Response bodies never enter errors or logs. No model request, purchase or reset action is supported.

## Available packages and limits

Headroom uses direct TypeScript HTTP helpers and pinned Zod schemas, following the official Kimi Code client [S3–S6, S9–S11]. No CLI, browser-storage reader or laptop helper runs during collection. Each account has its own encrypted credential and device boundary.

## Prior observations

The owner's membership-page screenshot showed monthly usage, while the browser-approved Headroom connection saved only five-hour and weekly windows. The owner subsequently requested removal of monthly stats. Personal screenshot values and raw account responses were not copied into fixtures. The earlier website membership reader [S7, S8] is no longer part of collection.

The first browser attempts were locally rejected by an overly strict approval-host check. A synthetic website-origin response reproduced that failure; accepting the region's official website origin corrected the check, after which the owner completed sign-in.

## Cannot promise

Monthly stats, every plan's quota access, private endpoint stability, comprehensive live refresh/revocation/deployment proof, CLI sign-in, Extra Usage or Moonshot API balances, and account mutations remain outside this connector's scope or evidence. A successful identity read alone does not prove every quota.

## Implementation and validation checklist

- [x] One regional browser approval flow, encrypted OAuth storage and automatic refresh.
- [x] Stable account identity, same-account reconnect, legacy key continuity and history preservation.
- [x] Synthetic modern/legacy session and weekly parsing, drift, exact resets, expiry, denial, throttling and isolation checks.
- [x] Remove monthly collection, presentation and placeholders, including cached monthly fields.
- [ ] Owner validates remaining refresh, revocation, two-account and deployment gates.

## Sources

- [S1: Kimi Code membership benefits](https://www.kimi.com/code/docs/en/kimi-code/membership.html).
- [S2: Kimi Code third-party tool API keys and regions](https://www.kimi.ai/help/kimi-code/membership-guide).
- [S3: Official Kimi Code profile client](https://github.com/MoonshotAI/kimi-code/blob/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651/packages/oauth/src/managed-userinfo.ts).
- [S4: Official Kimi Code usage client](https://github.com/MoonshotAI/kimi-code/blob/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651/packages/oauth/src/managed-usage.ts).
- [S5: Official Python Kimi CLI usage client](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/src/kimi_cli/ui/shell/usage.py).
- [S6: Official Kimi Code region profiles](https://github.com/MoonshotAI/kimi-code/blob/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651/packages/oauth/src/region.ts).
- [S7: Published membership HTTP reader](https://github.com/steipete/CodexBar/blob/f0fb26b160a023844228082f752dd3105e147ded/Sources/CodexBarCore/Providers/Kimi/KimiUsageFetcher.swift).
- [S8: Published membership response models](https://github.com/steipete/CodexBar/blob/f0fb26b160a023844228082f752dd3105e147ded/Sources/CodexBarCore/Providers/Kimi/KimiModels.swift).
- [S9: Official Kimi Code device authorization, polling and refresh](https://github.com/MoonshotAI/kimi-code/blob/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651/packages/oauth/src/oauth.ts).
- [S10: Official public OAuth configuration](https://github.com/MoonshotAI/kimi-code/blob/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651/packages/oauth/src/constants.ts).
- [S11: Official host and device identity contract](https://github.com/MoonshotAI/kimi-code/blob/eb2035f3cad57cc12d4d5082ec626f7f0ea5f651/packages/oauth/src/identity.ts).
- [S12: Official CLI issue showing the website approval route](https://github.com/MoonshotAI/kimi-cli/issues/1074).
