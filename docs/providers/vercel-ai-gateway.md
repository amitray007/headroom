# Vercel AI Gateway

Reviewed: 2026-10-01. This record covers the AI Gateway team's credits and spend reports. It does not treat a Vercel plan price as an AI Gateway balance.

## Scope and recommendation

Primary route: the official `@ai-sdk/gateway` package, called in-process from Headroom's TypeScript service per [ADR 0001](../decisions/0001-direct-provider-clients.md), using a one-time **AI Gateway API key** (next step `api_key`). Create the client with `createGateway({ apiKey })`. The team the key resolves to is recorded on the connection. This is the documented key type for the methods that return credits and reports [S1]. A Connect card opens the Vercel key page, accepts the pasted Gateway key, and validates it on the server. No local helper or CLI is involved.

`getCredits()` returns `balance` and `total_used`. `getSpendReport(params)` is available on Pro and Enterprise only. Pin the package version and record it in every snapshot.

The interface label is `official`: Vercel documents the credit and report methods. This is not a private endpoint, so ADR 0001's policy posture does not apply to it.

Do not use ACP. Do not use a general Vercel personal access token for these reads. The AI SDK permits access tokens for model requests, but says `getCredits`, `getSpendReport`, and `getGenerationInfo` require an AI Gateway key or OIDC [S1]. For a self-hosted deployment outside Vercel, use the Gateway key. OIDC is a deployment mechanism with hosting-specific expiry and refresh.

## Evidence status

| Claim | Evidence level | Basis |
| --- | --- | --- |
| `@ai-sdk/gateway` 4.0.102 calls `GET /v1/credits` and `GET /v1/report?start_date&end_date&group_by` on `https://ai-gateway.vercel.sh`, maps `total_used` to `totalUsed` and `total_cost` to `totalCost`, and wraps HTTP failures in `GatewayError` with a `statusCode` | source-inspected | Package bundle read on 2026-10-01 |
| `getCredits()` returns team `balance` and `total_used` | documented | AI SDK documentation [S1] |
| `getSpendReport` exists and is available on Pro and Enterprise plans | documented | [S1] |
| Credit and report methods require a Gateway key or OIDC | documented | Authentication section [S1] |
| Personal/app access token can make model requests | documented | Authentication section [S1] |
| OIDC is automatic in Vercel production/preview deployments | documented | OIDC section [S1] |
| `getCredits()` calls `GET /v1/credits` on the gateway origin (default base `https://ai-gateway.vercel.sh`) | source-inspected | [S2] |
| The credits endpoint selects the team from a `teamId` or `slug` query parameter; the package changelog records the fix | source-inspected | [S2] |
| The credits response shape is validated by the package's own schema | source-inspected | [S2] |
| A monthly $50 plan allowance maps to `balance` | unvalidated | No source ties plan price to the response |
| A key can resolve to several teams | unvalidated | Validate with a multi-team account |
| Any user can view a team's balance with a supplied key | unvalidated | Depends on key; validate the authorization result |
| An earlier signed-in environment returned a credit response | prior observation | Not a current validation; value omitted |

## Metrics

| Dashboard field | Upstream availability | Source and interpretation | Notes and limit |
| --- | --- | --- | --- |
| Current credit balance | Yes | `getCredits().balance` [S1] | `official`. Team-scoped, not monthly allowance. |
| Total credits used | Yes | `getCredits().total_used` [S1] | `official`. Reset period requires provider evidence. |
| Spend report | Pro/Enterprise only | `getSpendReport` [S1] | `official`. Plan gate, dimensions and date range. Without the plan: `unsupported` or `not_authorized`, not zero. |
| Generation cost / tokens | Yes by generation ID | `getGenerationInfo` [S1] | `official`. Not complete account history. Not collected. |
| Monthly allowance | `unknown` | No verified mapping | Do not label balance as allowance. |
| Renewal or reset timestamp | `unknown` | No verified contract | Do not infer calendar month. |
| Banked reset credits | `unknown` | No verified contract | Not an action target. |
| Usage history | Yes after collection | Headroom snapshots and reports | Provider retention unknown. |
| Team identity | Candidate | Authenticated response context | Validate selected team. |
| Admin / member difference | `unknown` | Key-dependent | Test least-privilege key. |

## Connect workflow

1. Create an attempt (`created`) with next step `api_key`: a field for the key and a link to the Vercel key page. The attempt moves to `awaiting_input`.
2. The user pastes the key once. The server encrypts it immediately. The attempt moves to `validating`.
3. Call `getCredits()`, passing the configured team when one is set. Probe spend reporting separately, because it requires an eligible plan. A failed report probe never discards a working balance connection.
4. If the response resolves a team identity, save it with the connection. If the key resolves to several teams, the next step is `select_account` and the attempt returns to `awaiting_input`. Do not mark the connection ready before a selection.
5. The attempt becomes `succeeded`. The connection is `ready`, or `partial` when the spend report is unavailable.
6. Each refresh job loads the encrypted key, calls the pinned package, writes a timestamped snapshot, and exits. The frontend reads only Headroom snapshots. A definitive 401 gives `reconnect_required`.

Do not ask for a Vercel personal access token just because it is familiar. It does not meet the documented requirement [S1].

## APIs and tools

| Interface | Method and endpoint | Label | Use in Headroom |
| --- | --- | --- | --- |
| Credits | `getCredits()`, which calls `GET /v1/credits` on `https://ai-gateway.vercel.sh` [S2] | `official` | `balance` and `total_used` for the selected team [S1]. Call first; it is the smallest useful read. |
| Spend report | `getSpendReport(params)` | `official` | Pro and Enterprise only [S1]. Date range and grouping are separate from credit access. |
| Generation info | `getGenerationInfo` | `official` | Not used. |

The credits endpoint selects the team from a `teamId` or `slug` query parameter. A credential that can access several teams must pass the configured team on every call. Without it the response may describe a different team.

Store `balance` and `total_used` as exact decimal strings with unit `credits`. Label them USD only if the adopted contract states that equivalence. Keep raw metadata separate from the normalized metric in case fields or units change. Do not surface prompts or request content.

Both `ai` and `@ai-sdk/gateway` expose the same provider. Pin `@ai-sdk/gateway` directly to avoid pulling the whole `ai` package.

### Refresh and reconnect

Gateway API keys are `not_refreshable`. A 401 or 403 from `getCredits()` is immediately definitive and sets `reconnect_required` with `token_rejected`; Reconnect asks for a new key and keeps the stored team selection. A spend-report failure on an ineligible plan is a capability result, never a reconnect.

## Available packages and limits

| Tool | Value | Limit |
| --- | --- | --- |
| `@ai-sdk/gateway` | Runtime dependency for credits and spend reports | Version-sensitive. Pin one version and record it in every snapshot. |
| Vercel OIDC | No user key in Vercel deployment | Hosting-bound lifecycle differs |
| Vercel access token | Model-request authentication | Not accepted for credit and report methods [S1] |
| Vercel CLI | Development OIDC assistance | Not needed for Connect |
| ACP | None | Does not add balance or report capability |

## Prior observations

An earlier credits request returned balance and usage values. It did not establish the expected recurring monthly allowance or confirm every team scope. Values are not retained as fixtures.

## Cannot promise

- The package's HTTP endpoints stay stable across versions. Vercel documents the methods, not the paths.
- A stated monthly plan amount equals Gateway credits.
- A renewal date, weekly/hourly limit, or banked reset inventory.
- Cross-team aggregation without explicit multi-team selection.
- A personal Vercel token grants billing access.
- Key revocation from Headroom. Disconnect deletes the stored key (`local_only`); the user deletes the key on Vercel.
- Per-request content visibility; Headroom requires aggregate data only.

## Implementation and validation checklist

- [ ] Pin `@ai-sdk/gateway` and record the version in every snapshot.
- [ ] Pass the configured team to `getCredits()` and test a credential that reaches several teams.
- [ ] Create Gateway API-key storage and server-only transport.
- [ ] Validate the credits call with a scoped test key.
- [ ] Save `balance`, `total_used`, unit, team identity, and snapshot time.
- [ ] Inspect the live spend-report schema on an eligible plan and define a date range.
- [ ] Test a non-eligible plan: the report is `unsupported` or `not_authorized` and the balance still works.
- [ ] Test revoked key (`reconnect_required`), missing access, and multiple-team access (`select_account`).
- [ ] Add synthetic fixtures for success, partial response and schema drift. Return `invalid_response` on drift.
- [ ] Explain the balance-versus-plan distinction in the product UI.
- [ ] Add rate-limit backoff and stale-snapshot display.
- [ ] Do not implement credit purchase, renewal, or reset actions.

## Sources

- [S1] Vercel AI SDK, [AI Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway), reviewed 2026-10-01.
- [S2] Vercel AI SDK, [gateway-fetch-metadata.ts](https://github.com/vercel/ai/blob/main/packages/gateway/src/gateway-fetch-metadata.ts), reviewed 2026-10-01.
