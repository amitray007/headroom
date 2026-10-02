# Notifications

Headroom tells the owner when an account needs attention. Today the browser builds each notification from the latest overview and the owner's settings, then shows it in the bell. The server stores nothing and sends nothing. Every notification is a `NotificationEvent`, so the server can later build identical events and deliver them.

Code: `apps/web/src/lib/notifications.ts` (detection), `packages/core/src/notification-event.ts` (event schema), `packages/core/src/settings.ts` (settings). Enumerations are in `packages/core/src/enums.ts` and [the data model](data-model.md).

## What is detected

| Provider | Limits (Running Low, Almost Out) | Expiring Resets | Balance | Spend | Extra usage |
| --- | --- | --- | --- | --- | --- |
| Claude | Session, weekly, model-scoped weekly | Reset grants | None | `extra_usage.used` against `extra_usage.monthly_limit`, USD | None |
| Codex | Primary and secondary windows | Banked reset credits | None: a credits balance has no known total | None | None |
| Cursor | Included usage and pools | None | None | `on_demand.used` against `on_demand.limit`, same scope, USD | None |
| Grok | Weekly pool and product shares | None | None: prepaid has no known total | `on_demand.used` against `on_demand_cap` when the cap is above 0, in `grok_credits` | None |
| Antigravity | Quota windows | None | None | None | None |
| Copilot | Monthly credits percent | None | None | None | `extra_usage.count` above 0 |
| Vercel AI Gateway | None | None | `credits.balance` against balance plus `credits.total_used` | None | None |

Every kind also covers sign-in and refresh problems for every provider. An unknown or unavailable value raises nothing: unknown is not zero. A paused or disconnected account raises no limit, balance, spend or extra-usage notice.

## Kinds

Tone is `bad`, `warn` or `info`. "Left" is the percent of the limit still free. The Running Low threshold is `lowThresholdPercent` (30, 20 or 15).

| Kind | Trigger | Tone | Switch | Dedupe id (after the connection id) |
| --- | --- | --- | --- | --- |
| `running_low` | A percent meter has less than the threshold left | `warn` | `runningLow` | `running_low:<metricKey>:<resetsAt>` |
| `almost_out` | A percent meter has under 10% left | `bad` | `runningLow` | `almost_out:<metricKey>:<resetsAt>` |
| `reset_expiring` | A usable banked reset expires within `resetLeadDays`. One notice, for the soonest | `info` | `expiringResets` | `reset_expiring:<creditId>:<expiresAt>` |
| `balance_low` | Vercel balance is under the threshold of balance plus total used. Under 10% is `bad`. Only when both are reported and the total is above 0 | `warn`, `bad` | `balances` | `balance_low:credits.balance:<total>:<tone>` (a top-up changes the total) |
| `spend_near_cap` | Spend is at least (100 - threshold)% of its cap | `warn` | `spend` | `spend_near_cap:<spendKey>:<periodEnd>` |
| `spend_cap_reached` | Spend is at least 100% of its cap | `bad` | `spend` | `spend_cap_reached:<spendKey>:<periodEnd>` |
| `extra_usage_started` | Copilot `extra_usage.count` is above 0 | `info` | `spend` | `extra_usage_started:extra_usage.count:<periodEnd>` |
| `refresh_failed` | The latest run failed, state is not paused | `warn` | `refreshFailures` | `refresh_failed::<lastSuccessAt>` |
| `disconnected` | Connection state is `reconnect_required` | `bad` | `refreshFailures` | `disconnected:<reconnectReason>:<lastSuccessAt>` |

`<resetsAt>`, `<expiresAt>` and `<lastSuccessAt>` are epoch milliseconds. `<periodEnd>` is the period's end when the metric or its anchor reports one (Cursor cycle end, Grok weekly reset, Copilot monthly reset). Without one it is the UTC month of the reading, `YYYY-MM`, as for Claude extra usage. An id stays the same while the situation lasts and changes for the next period, so a repeat appears again as unread.

Rules that apply to every kind:

- A muted provider (`mutedProviders`) raises nothing except `disconnected`. A broken sign-in still matters.
- `includeSessions` off skips meters whose window is 5 hours or shorter.
- Claude reports the weekly all-models limit and model-scoped weekly limits that overlap it. When the all-models limit and a scoped limit are both low with the same tone, only the tighter one is raised. With different tones, both are raised.
- Money is in USD. Grok and Vercel figures are credits and never use a dollar sign. Units are never converted.
- Read state stays in the browser. Ids of switched-off kinds are kept so a toggle does not mark them unread again.

## Settings

The `notifications` object of [the settings document](api.md#settings):

| Key | Values | Default |
| --- | --- | --- |
| `runningLow`, `expiringResets`, `balances`, `spend`, `refreshFailures` | boolean, one per type | true |
| `includeSessions` | boolean | true |
| `resetLeadDays` | 1, 3, 7 | 3 |
| `mutedProviders` | list of provider names | empty |

Settings, Notifications tab: "Types" holds the five switches and the reset lead, "Limits" holds Include 5-Hour Sessions, and "Providers" holds one switch per connected provider in the saved order. The note "Sign-in problems are always shown." sits under the provider switches.

## Event schema

`notificationEventSchema` (version 1, strict: no unknown fields). All times are epoch milliseconds. A figure that is unknown is left out, never zero.

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Changes only with a breaking change |
| `id` | string | Stable dedupe key, see the table above |
| `kind` | `notification.kind` | |
| `tone` | `notification.tone` | |
| `occurredAt` | integer | When the situation was seen |
| `observedAt` | integer | When Headroom last read the account |
| `provider` | provider name | |
| `connection` | `{ id, name, plan }` | Internal id, the owner's name for the account or its scope word, plan or null. No email, login or other identifier |
| `subject` | `{ metricKey, label, window }` | Each a string or null |
| `figures` | object, all optional | `percentUsed`, `percentLeft`, `resetsAt`, `amount { value, unit }`, `cap { value, unit }`, `expiresAt`. `amount` is spend, a balance or a count. `cap` is what it counts against: the spending cap, or the total granted for a balance. `unit` is `notification.amount.unit` |
| `title` | string | Title Case headline |
| `message` | string | One short plain sentence or two |
| `links` | `{ dashboard? }` | Absolute URL of the dashboard, when the server knows it |

The `title` and `message` the browser builds follow the owner's display settings (used or left, countdown or exact time). Server delivery will use fixed wording.

### Examples

Running Low (Claude weekly):

```json
{
  "schemaVersion": 1,
  "id": "c1:running_low:seven_day:1790000000000",
  "kind": "running_low",
  "tone": "warn",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "claude",
  "connection": { "id": "c1", "name": "Personal", "plan": "max_5x" },
  "subject": { "metricKey": "seven_day", "label": "Weekly", "window": "all models" },
  "figures": { "percentUsed": 78, "percentLeft": 22, "resetsAt": 1790000000000 },
  "title": "Claude Weekly Limit Is Running Low",
  "message": "78% used. Resets in 52 min.",
  "links": {}
}
```

Almost Out (Claude model-scoped):

```json
{
  "schemaVersion": 1,
  "id": "c1:almost_out:limits.Fable:1790000000000",
  "kind": "almost_out",
  "tone": "bad",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "claude",
  "connection": { "id": "c1", "name": "Personal", "plan": "max_5x" },
  "subject": { "metricKey": "limits.Fable", "label": "Weekly", "window": "Fable" },
  "figures": { "percentUsed": 91, "percentLeft": 9, "resetsAt": 1790000000000 },
  "title": "Claude Is Almost Out of Its Weekly Fable Limit",
  "message": "91% used. Resets in 52 min.",
  "links": {}
}
```

Reset Expiring (Codex):

```json
{
  "schemaVersion": 1,
  "id": "x1:reset_expiring:rc-1:1790200000000",
  "kind": "reset_expiring",
  "tone": "info",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "codex",
  "connection": { "id": "x1", "name": "Personal", "plan": "plus" },
  "subject": { "metricKey": null, "label": "Banked Resets", "window": null },
  "figures": { "expiresAt": 1790200000000 },
  "title": "A Codex Reset Expires in 3 Days",
  "message": "1 of 3 banked full resets expires Oct 5.",
  "links": {}
}
```

Balance Low (Vercel AI Gateway):

```json
{
  "schemaVersion": 1,
  "id": "v1:balance_low:credits.balance:10.00:warn",
  "kind": "balance_low",
  "tone": "warn",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "vercel_ai_gateway",
  "connection": { "id": "v1", "name": "Gateway", "plan": null },
  "subject": { "metricKey": "credits.balance", "label": "Credit Balance", "window": null },
  "figures": {
    "percentUsed": 80,
    "percentLeft": 20,
    "amount": { "value": 2, "unit": "gateway_credits" },
    "cap": { "value": 10, "unit": "gateway_credits" }
  },
  "title": "Vercel AI Gateway Credits Are Running Low",
  "message": "80% used. 2.00 of 10.00 credits remain.",
  "links": {}
}
```

Spend Near Cap (Claude extra usage):

```json
{
  "schemaVersion": 1,
  "id": "c1:spend_near_cap:extra_usage.used:2026-10",
  "kind": "spend_near_cap",
  "tone": "warn",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "claude",
  "connection": { "id": "c1", "name": "Personal", "plan": "max_5x" },
  "subject": { "metricKey": "extra_usage.used", "label": "Extra Usage", "window": null },
  "figures": {
    "percentUsed": 70,
    "percentLeft": 30,
    "amount": { "value": 35, "unit": "USD" },
    "cap": { "value": 50, "unit": "USD" }
  },
  "title": "Claude Extra Usage Is Near Its Cap",
  "message": "$35.00 of $50.00 spent.",
  "links": {}
}
```

Spend Cap Reached (Grok on-demand, credits):

```json
{
  "schemaVersion": 1,
  "id": "g1:spend_cap_reached:on_demand.used:1790600000000",
  "kind": "spend_cap_reached",
  "tone": "bad",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "grok",
  "connection": { "id": "g1", "name": "Personal", "plan": null },
  "subject": { "metricKey": "on_demand.used", "label": "On-Demand Use", "window": null },
  "figures": {
    "percentUsed": 100,
    "percentLeft": 0,
    "amount": { "value": 1000, "unit": "grok_credits" },
    "cap": { "value": 1000, "unit": "grok_credits" },
    "resetsAt": 1790600000000
  },
  "title": "Grok On-Demand Use Has Reached Its Cap",
  "message": "1,000 of 1,000 credits used.",
  "links": {}
}
```

Extra Usage Started (Copilot):

```json
{
  "schemaVersion": 1,
  "id": "p1:extra_usage_started:extra_usage.count:1790100000000",
  "kind": "extra_usage_started",
  "tone": "info",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "copilot",
  "connection": { "id": "p1", "name": "Personal", "plan": "pro" },
  "subject": { "metricKey": "extra_usage.count", "label": "Extra Usage", "window": "monthly" },
  "figures": { "amount": { "value": 3, "unit": "credits" }, "resetsAt": 1790100000000 },
  "title": "Copilot Has Started Extra Usage",
  "message": "3 extra credits used this month.",
  "links": {}
}
```

Refresh Failed:

```json
{
  "schemaVersion": 1,
  "id": "k1:refresh_failed::1789900000000",
  "kind": "refresh_failed",
  "tone": "warn",
  "occurredAt": 1789990000000,
  "observedAt": 1789900000000,
  "provider": "cursor",
  "connection": { "id": "k1", "name": "Personal", "plan": "pro" },
  "subject": { "metricKey": null, "label": null, "window": null },
  "figures": {},
  "title": "Cursor Refresh Failed",
  "message": "Headroom could not refresh this account. It will try again in a few minutes.",
  "links": {}
}
```

Disconnected:

```json
{
  "schemaVersion": 1,
  "id": "x2:disconnected:refresh_rejected:1789800000000",
  "kind": "disconnected",
  "tone": "bad",
  "occurredAt": 1789990000000,
  "observedAt": 1789800000000,
  "provider": "codex",
  "connection": { "id": "x2", "name": "Work", "plan": "pro" },
  "subject": { "metricKey": null, "label": null, "window": null },
  "figures": {},
  "title": "Codex Is Disconnected",
  "message": "The sign-in for this account has expired. Reconnect to keep tracking it.",
  "links": {}
}
```

## Delivery (planned)

Not built. Nothing below exists in code. The browser bell is the only delivery today.

- **Server-side evaluation.** The server builds events after each collection with the same rules, so delivery works when no browser is open. The detection code moves to `packages/core` and the browser keeps using it for the bell.
- **Telegram.** The owner enters a bot token and a chat id in the Notifications tab. The server stores them encrypted, the same way as provider credentials. It sends the event `title` and `message`.
- **Webhook.** The owner sets an `https` URL. The server POSTs `application/json`, the event itself, with these headers:
  - `X-Headroom-Signature`: HMAC-SHA256 over the raw request body, using a per-webhook secret shown once.
  - `X-Headroom-Event`: the event `kind`.
- **Retries.** Failed deliveries retry with backoff, then stop and show as failed in the log.
- **Idempotency.** The event `id` is the dedupe key. A receiver can drop a repeat, and the server never sends the same id twice to one destination while it is recorded as delivered.
- **Delivery log.** The server records each attempt per destination: event id, time, status, and the failure class, without credentials or response bodies.

These choices need an ADR in `docs/decisions/` when they are built.
