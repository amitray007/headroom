# Notifications

Headroom tells the owner when an account needs attention. The browser builds each notification from the latest overview and the owner's settings, then shows it in the bell. The server builds the same events after each collection pass and delivers them to Telegram chats and webhooks the owner set up. Every notification is a `NotificationEvent`; read state stays in the browser.

Code: `packages/view-model/src/notifications.ts` (detection, shared by the web app and the server), `packages/view-model/src/automation.ts` (what the Automations settings list), `packages/core/src/notification-event.ts` (event schema), `packages/core/src/settings.ts` (settings). Enumerations are in `packages/core/src/enums.ts` and [the data model](data-model.md). The detected events, auto-reset rule and budgets behind the newer kinds are specified in [ADR 0003](../decisions/0003-owner-automations.md).

## What is detected

| Provider | Limits (Running Low, Almost Out) | Expiring Resets | Balance | Spend | Extra usage | Detected events |
| --- | --- | --- | --- | --- | --- | --- |
| Claude | Session, weekly, model-scoped weekly | Reset grants | None | `extra_usage.used` against `extra_usage.monthly_limit`, USD, and the owner's budget | `extra_usage.used` above 0, USD | New reset grant, early reset |
| Codex | Primary and secondary windows | Banked reset credits | None: a credits balance has no known total | None | None | New banked reset, early reset, auto-reset, balance top-up (`credits.balance`) |
| Cursor | Included usage and pools | None | None | `on_demand.used` against `on_demand.limit`, same scope, USD, and the owner's budget | `on_demand.used` above 0, USD | Early reset |
| Grok | Weekly pool and product shares | None | None: prepaid has no known total | `on_demand.used` against `on_demand_cap` when the cap is above 0, in `grok_credits`, and the owner's budget | `on_demand.used` above 0, in `grok_credits` | Early reset, balance top-up (`prepaid_balance`) |
| Antigravity | Quota windows | None | None | None | None | Early reset |
| Copilot | Monthly credits percent | None | None | None | `extra_usage.count` above 0 | Early reset |
| Vercel AI Gateway | None | None | `credits.balance` against balance plus `credits.total_used` | `spend.30d`, only against the owner's budget | None | Balance top-up (granted total) |

Every kind also covers sign-in and refresh problems for every provider. An unknown or unavailable value raises nothing: unknown is not zero. A paused or disconnected account raises no limit, balance, spend, extra-usage, budget or detected-event notice. Two things ignore account state: a failed or `uncertain` auto-reset (and a succeeded one, unless the provider is muted), and an expiring Wallet top-up, which is about the Wallet and not the account's connection.

## Kinds

Tone is `bad`, `warn` or `info`. "Left" is the percent of the limit still free. The Running Low threshold is `lowThresholdPercent` (30, 20 or 15).

| Kind | Trigger | Tone | Switch (`notifications.kinds.<key>`) | Dedupe id (after the connection id) |
| --- | --- | --- | --- | --- |
| `running_low` | A percent meter has less than the threshold left | `warn` | `running_low` | `running_low:<metricKey>:<resetsAt>` |
| `almost_out` | A percent meter has under 10% left | `bad` | `almost_out` | `almost_out:<metricKey>:<resetsAt>` |
| `reset_expiring` | A usable banked reset expires within `resetLeadDays`. One notice, for the soonest | `info` | `reset_expiring` | `reset_expiring:<creditId>:<expiresAt>` |
| `balance_low` | Vercel balance is under the threshold of balance plus total used. Under 10% is `bad`. Only when both are reported and the total is above 0 | `warn`, `bad` | `balance_low` | `balance_low:credits.balance:<total>:<tone>` (a top-up changes the total) |
| `spend_near_cap` | Spend is at least (100 - threshold)% of its cap | `warn` | `spend_near_cap` | `spend_near_cap:<spendKey>:<periodEnd>` |
| `spend_cap_reached` | Spend is at least 100% of its cap | `bad` | `spend_cap_reached` | `spend_cap_reached:<spendKey>:<periodEnd>` |
| `extra_usage_started` | Copilot `extra_usage.count`, Cursor or Grok `on_demand.used`, or Claude `extra_usage.used` is above 0 | `info` | `extra_usage_started` | `extra_usage_started:<metricKey>:<periodEnd>` |
| `budget_near` | Spend on a metric the owner set a budget for is at least (100 - threshold)% of the budget | `warn` | `budget_near` | `budget_near:<metricKey>:<periodEnd>:<amount>` |
| `budget_exceeded` | Spend is at least the budget | `bad` | `budget_exceeded` | `budget_exceeded:<metricKey>:<periodEnd>:<amount>` |
| `credits_expiring` | A Wallet top-up has an expiry and an alert, today (UTC) is within `expiryAlertDays` of `expiresOn`, and `expiresOn` has not passed | `warn` | `credits_expiring` | `credits_expiring:<topUpId>:<expiresOn>` |
| `reset_granted` | A `reset_granted` event from the last 72 hours | `info` | `reset_granted` | `reset_granted:<eventId>` |
| `early_reset` | An `early_reset` event from the last 72 hours. `includeSessions` off skips windows of 5 hours or less | `info` | `early_reset` | `early_reset:<eventId>` |
| `auto_reset` | An `auto_reset` event from the last 72 hours | `info` when succeeded, `warn` when failed or `uncertain` | `auto_reset` | `auto_reset:<eventId>` |
| `top_up_detected` | A `top_up_detected` event from the last 72 hours | `info` | `top_up_detected` | `top_up_detected:<eventId>` |
| `refresh_failed` | Two or more refreshes in a row failed (`latestRun.failureStreak`), state is not paused | `warn` | `refresh_failed` | `refresh_failed::<lastSuccessAt>` |
| `disconnected` | Connection state is `reconnect_required` | `bad` | `disconnected` | `disconnected:<reconnectReason>:<lastSuccessAt>` |

A rejected key or sign-in on an account that worked before is re-checked about 2 minutes later before it counts as disconnected. A revoked refresh token stays immediate.

`<resetsAt>`, `<expiresAt>` and `<lastSuccessAt>` are epoch milliseconds. `<eventId>` is the id of the account event, so one event is one notice. `<expiresOn>` is the top-up's expiry day, `YYYY-MM-DD`. `<amount>` is the owner's budget amount, so a changed budget starts a new notice. `<periodEnd>` is the period's end when the metric or its anchor reports one (Cursor cycle end, Grok weekly reset, Copilot monthly reset). Without one it is the UTC month of the reading, `YYYY-MM`, as for Claude extra usage. An id stays the same while the situation lasts and changes for the next period, so a repeat appears again as unread.

Rules that apply to every kind:

- A muted provider (`mutedProviders`) raises nothing except `disconnected`, and an `auto_reset` that failed or ended `uncertain`. A broken sign-in and an unknown reset result still matter.
- `includeSessions` off skips meters whose window is 5 hours or shorter.
- Claude reports the weekly all-models limit and model-scoped weekly limits that overlap it. When the all-models limit and a scoped limit are both low with the same tone, only the tighter one is raised. With different tones, both are raised.
- Money is in USD. Grok, Codex and Vercel figures are credits and never use a dollar sign. Units are never converted.
- Event notices come from `connection.events` (the last 7 days, at most 20) and show for 72 hours after `occurredAt`. Budget notices come from `connection.automation.budgets`; the overview carries both, so the browser bell and server delivery derive the same notices. Expiring credits come from the Wallet's top-ups, passed to the derivation as `topUps`.
- Read state stays in the browser. Ids of switched-off kinds are kept so a toggle does not mark them unread again.

## Settings

The `notifications` object of [the settings document](api.md#settings):

| Key | Values | Default |
| --- | --- | --- |
| `kinds` | object with one boolean per kind in the Kinds table, keyed by the kind | all true |
| `includeSessions` | boolean | true |
| `resetLeadDays` | 1, 3, 7 | 3 |
| `mutedProviders` | list of provider names | empty |

Every kind has its own switch. An older stored document with the group switches `runningLow`, `expiringResets`, `balances`, `spend`, `resetActivity` and `refreshFailures` loads with each group's value applied to the kinds it covered; a key in `kinds` wins over the old flag. Switching `disconnected` off silences it even though a muted provider never does.

Every notice that is on goes to the in-app bell and to every enabled channel (Telegram, webhooks). There is no per-channel choice of kind.

Settings, Notifications tab: a short line saying so, then "Limits" (Running Low, Almost Out, Include 5-Hour Sessions), "Resets" (Expiring Reset, the reset lead, New Banked Reset, Early Reset, Auto-Reset Result), "Balances and Credits", "Spend" (On-Demand Started, Near Spending Cap, Spending Cap Reached, Near Your Budget, Over Your Budget), "Sign-In" (Refresh Failed, Disconnected), and "Providers" with one switch per connected provider in the saved order.

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
| `connection` | `{ id, name, plan, identity? }` | Internal id, the owner's name for the account or its scope word, plan or null. `identity` is the account's email or login. It is present only for a destination whose owner chose to include it, see [Identity](#identity) |
| `subject` | `{ metricKey, label, window }` | Each a string or null |
| `figures` | object, all optional | `percentUsed`, `percentLeft`, `resetsAt`, `amount { value, unit }`, `cap { value, unit }`, `expiresAt`. `amount` is spend, a balance or a count. `cap` is what it counts against: the spending cap, or the total granted for a balance. `unit` is `notification.amount.unit` |
| `title` | string | Title Case headline |
| `message` | string | One short plain sentence or two |
| `links` | `{ dashboard? }` | Absolute URL of the dashboard, when the server knows it |

The `title` and `message` the browser builds follow the owner's display settings (used or left, countdown or exact time). Server delivery uses the same derivation with the time style forced to countdown, because the server has no browser time zone.

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

Reset Granted (Codex):

```json
{
  "schemaVersion": 1,
  "id": "x1:reset_granted:ev-7f3a",
  "kind": "reset_granted",
  "tone": "info",
  "occurredAt": 1789980000000,
  "observedAt": 1789990000000,
  "provider": "codex",
  "connection": { "id": "x1", "name": "Personal", "plan": "plus" },
  "subject": { "metricKey": null, "label": "Banked Resets", "window": null },
  "figures": { "expiresAt": 1791500000000 },
  "title": "Codex Banked a New Reset",
  "message": "3 banked resets available. The new one expires Oct 9.",
  "links": {}
}
```

Budget Near (Cursor on-demand, owner budget of $50):

```json
{
  "schemaVersion": 1,
  "id": "k1:budget_near:on_demand.used:1790600000000:50",
  "kind": "budget_near",
  "tone": "warn",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "cursor",
  "connection": { "id": "k1", "name": "Personal", "plan": null },
  "subject": { "metricKey": "on_demand.used", "label": "On-Demand Spend", "window": null },
  "figures": {
    "percentUsed": 70,
    "percentLeft": 30,
    "amount": { "value": 35, "unit": "USD" },
    "cap": { "value": 50, "unit": "USD" },
    "resetsAt": 1790600000000
  },
  "title": "Cursor On-Demand Spend Is Near Your Budget",
  "message": "$35.00 of your $50.00 budget spent.",
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

## Delivery

The server sends each current notification once to each enabled channel. Decision: D25 in [the decision register](../decisions/README.md).

A channel is one destination: a Telegram chat or a webhook URL. The owner manages channels with `/api/delivery` ([API](api.md#delivery)). The bot token, chat id, webhook URL and signing secret are sealed in `notification_channels.config_ciphertext` under the master key, bound to the row, the same way as provider credentials. No GET route returns them. A webhook secret is shown once, when the channel is created or its secret rotated.

### Setup flow

The web UI tests a channel before it saves it. For Telegram: verify the bot token (`/telegram/bot`), find the chat (`/telegram/chats`), send a test (`/verify`), then save. For a webhook: enter the URL, let the browser generate the signing secret so the owner can store it in the receiver, send a signed test (`/verify`), then save with that secret. `/verify` stores nothing and records no delivery.

### When it runs

After every scheduler tick the dispatcher reads the overview, derives the events with the owner's settings (time style forced to `countdown`), adds `links.dashboard` when `HEADROOM_PUBLIC_URL` is set, and sends. It does nothing when no channel is enabled. A new channel receives the notices that are active at the next pass. The dedupe record keeps each one to a single send.

- Sends are sequential, at most 20 per pass. The rest wait for the next pass.
- Each event is validated against `notificationEventSchema` before it is sent. An invalid event is dropped and logged at warn level.
- An event that is no longer derived is never sent again, so a notice that cleared stops retrying.
- The server does not send a read or cleared message. A repeat in the next period has a new id and sends again.

### Retries and the delivery record

`notification_deliveries` holds one row per channel and event id: status, attempt count, failure class, and the next attempt time. A `delivered` or `failed` event is skipped. A `retrying` event is resent once its next attempt time has passed.

| Failed attempt | Wait before the next |
| --- | --- |
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 60 minutes |
| 5 | Stop: status `failed` |

A Telegram 429 uses `retry_after` when it is longer than the wait above. Rows older than 60 days are deleted once per pass. Deleting a channel deletes its rows. Test sends are not recorded.

Failure classes (`notification.delivery.failure`): `timeout` (10 seconds), `network`, `unauthorized` (401, 403), `not_found` (404; for Telegram also chat not found and bot blocked), `rate_limited` (429), `rejected` (other 4xx and every 3xx), `server_error` (5xx). Requests never follow a redirect.

### Telegram

`POST https://api.telegram.org/bot<token>/sendMessage` with `parse_mode: "HTML"` and link previews off. Text, with `&`, `<` and `>` escaped:

```
<b>{title}</b>
{message}
{Provider} · {connection name} · {plan as words, when known} · {identity, when included}
<a href="{dashboard}">Open Headroom</a>   (only when HEADROOM_PUBLIC_URL is set)
```

The server reads only `ok`, `error_code`, `parameters.retry_after` and, for `getMe` and `getUpdates`, the result. The `description` field can echo request data, so it only picks a failure class. It is never stored or logged. `getMe` checks a token when a channel is created or its token changes. `getUpdates` finds the chats that wrote to the bot in the last 24 hours, so the owner can pick a chat id.

### Webhook

`POST` to the owner's URL. Only `http:` and `https:` are accepted, and a URL with `user:pass@` is refused. `http:` is allowed because receivers on a LAN often have no certificate. Body:

```json
{ "type": "notification", "timestamp": "2026-10-03T12:00:00.000Z", "data": { "...": "the NotificationEvent" } }
```

The test message has `"type": "test"` and `"data": { "message": "Notifications will arrive at this URL." }`. A response with status 200 to 299 is a delivery. The response body is never read.

Headers follow [Standard Webhooks](https://www.standardwebhooks.com/):

| Header | Value |
| --- | --- |
| `webhook-id` | `msg_` plus a hash of channel id and event id. The same across retries, so a receiver can drop a repeat |
| `webhook-timestamp` | Unix seconds when the attempt was sent |
| `webhook-signature` | `v1,` plus base64 HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{raw body}`, keyed with the base64-decoded part of the secret after `whsec_` |
| `x-headroom-event` | The event `kind`, or `test` |
| `user-agent` | `Headroom/<version>` |

Verify a request on the receiver. Use the raw body text, not a parsed copy:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret: string, headers: Headers, rawBody: string): boolean {
  const id = headers.get("webhook-id") ?? "";
  const timestamp = headers.get("webhook-timestamp") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replay window
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return (headers.get("webhook-signature") ?? "").split(" ").some((part) => {
    const [version, signature] = part.split(",");
    const given = Buffer.from(signature ?? "", "base64");
    return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
  });
}
```

### Identity

A channel has `includeIdentity`, off by default. When it is on, the server adds `connection.identity` (the account's email or login, from the stored account label) to each event for that channel, and Telegram shows it in the account line. A channel without it receives events with no personal identifier.

### What is logged

One line per attempt: channel id, event kind, status and failure class. The log never holds a token, chat id, URL, secret, response body or error message from the network library.

