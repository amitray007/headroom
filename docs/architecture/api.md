# HTTP API

**Status: implemented in `apps/server`. The web client in `apps/web` is the only consumer.**

Every route lives under `/api`. Instants are epoch milliseconds. All routes except `/api/auth/*`, `/api/setup` and `/healthz` need a Better Auth session. Mutating routes also pass the cross-site guard. Error bodies are `{ "error": "<code>" }`.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/overview` | Every account with its latest snapshot, run and action state in one call |
| `GET /api/connections` | Light list: state, label, name, staleness, latest run, metric count |
| `GET /api/connections/:id` | One connection with capabilities, snapshot and latest run |
| `PATCH /api/connections/:id` | Set or clear the owner-set display name |
| `POST /api/connections/:id/{refresh,pause,reconnect,actions}` | Owner-triggered operations; actions are gated, see below |
| `PUT /api/connections/:id/auto-reset`, `DELETE /api/connections/:id/auto-reset` | Set or clear the account's auto-reset rule, see [Automations](#automations) |
| `PUT /api/connections/:id/budgets/:metricKey`, `DELETE /api/connections/:id/budgets/:metricKey` | Set or clear the account's budget for one spend metric |
| `DELETE /api/connections/:id` | Disconnect and delete local data |
| `GET /api/providers`, `/api/attempts/...` | Connect flow, see [the connection lifecycle](connections.md) and [Providers](#providers) |
| `GET /api/settings`, `PUT /api/settings` | Owner preferences |
| `PUT /api/order` | Owner-defined order of providers and of accounts within a provider |
| `GET /api/wallet` | The owner's Wallet entries: costs and top-ups, see [Wallet](#wallet) |
| `PUT /api/wallet/costs/:connectionId`, `DELETE /api/wallet/costs/:connectionId` | Set the cost of one connection, or clear it back to Not set |
| `POST /api/wallet/top-ups`, `PUT /api/wallet/top-ups/:id`, `DELETE /api/wallet/top-ups/:id` | Record a top-up, edit one, or remove one |
| `GET /api/exchange-rates`, `POST /api/exchange-rates/refresh` | The daily reference rates the Wallet converts with; the POST fetches them again now, at most once a minute, and touches no account |
| `/api/delivery/...` | Notification channels (Telegram, webhook), tests and Telegram chat discovery, see [Delivery](#delivery) |

## Overview

`GET /api/overview` returns `{ connections, providerOrder, refreshIntervalMs, staleAfterMs }`. `providerOrder` lists every provider in the owner's effective order. Connections follow it, then the owner's account position (unpositioned last), then creation time. `GET /api/connections` uses the same order. Each entry holds:

- `id`, `provider`, `scope`, `state`, `reconnectReason`, `interface`, `authMethod`, `createdAt`, `lastSuccessAt`, `stale`.
- `name`: the owner-set display name, or null.
- `identity` and `plan`: the stored label split by `splitLabel` in `packages/core/src/label.ts`. The identity is the text before a trailing ` (<plan>)`. It is null when empty or when it equals the generic fallback label of the provider (for example `Codex`). The plan is null when absent or when it only repeats the product name, as in the Copilot label `<login> (Copilot)`.
- `latestRun`: `{ startedAt, finishedAt, outcome, error, failureStreak }` or null. `outcome` is null while a run is in flight. `failureStreak` counts the most recent finished runs, newest first, that failed in a row (0 to 5; a run in flight is ignored).
- `snapshot`: `{ observedAt, metrics, resetCredits }` or null. Metrics and reset credits have the same fields as in the detail route.
- `actions`: `{ enabled, supported }`, where `enabled` is the effective gate.
- `events`: the account's events from the last 7 days, newest first, at most 20. Each is `{ id, connectionId, occurredAt, metricKey, detail }` and `detail` is one of the `accountEventDetailSchema` shapes (`reset_granted`, `early_reset`, `top_up_detected`, `auto_reset`). They carry numbers and ids only. One query reads the events of every account.
- `automation`: `{ autoReset, budgets }`. `autoReset` is the owner's rule `{ enabled, window, thresholdPercent, minHoursLeft }` or null. `budgets` lists `{ metricKey, amount, unit }`, one per spend metric the owner set a budget for.

The response carries no provider account id or workspace id. The detail route is built field by field for the same reason.

## Providers

`GET /api/providers` returns `{ providers }`. Each entry is `{ provider, version, interface, methods, availability }`. `availability` has one `{ method, available, reason, cli }` per method: `reason` is `cli_not_installed` or null, and `cli` names the program a `cli_login` method needs, else null. Clients that predate the field treat every method as usable. See [Method availability](connections.md#method-availability).

`POST /api/attempts` and the reconnect route answer `409 { error: "method_unavailable", method, reason, cli }` when the method cannot start on this host, for example `The codex CLI is not installed on the server`. No attempt is created.

## Display name

`PATCH /api/connections/:id` takes `{ "name": string | null }`. The server trims the text. An empty string or null clears the name. More than 40 characters after trimming is `400 invalid_body`. An unknown id is `404`. The response is `{ "name": string | null }`.

## Settings

`GET /api/settings` returns `{ settings }`. `PUT /api/settings` takes the full settings object, validates it against `settingsSchema` and returns the same shape, or `400 invalid_body`.

| Key | Values | Default |
| --- | --- | --- |
| `limitsView` | `used`, `left` | `used` |
| `lowThresholdPercent` | 30, 20, 15 (percent left below which a limit reads "running low") | 30 |
| `refreshIntervalMinutes` | 5, 10, 15, 30 | the option nearest to `HEADROOM_REFRESH_INTERVAL_SECONDS` |
| `timeStyle` | `countdown`, `exact` | `countdown` |
| `clock` | `24h`, `12h` | `24h` |
| `density` | `comfortable`, `compact` | `comfortable` |
| `detailedOrder` | `urgency`, `provider`, `custom` (how the Detailed view sorts by default; provider and custom orders come from the saved display order, `PUT /api/order`, not from settings) | `urgency` |
| `keepInactiveLast` | boolean (the Detailed view keeps paused and disconnected accounts at the bottom) | true |
| `historyRetentionDays` | 30, 90, 180, 365 (how long snapshots and sync runs are kept; the newest of each per connection is always kept) | 90 |
| `accountActions` | boolean | false |
| `providers` | An object keyed by provider name; each value is `{ "hideZeroBalance": boolean }` (leave every balance figure of the provider out of its panels while it is exactly 0; spend figures stay). Only Claude offers it so far, covering Usage Credits and Cloud Credits; the Settings Providers tab shows the switch only for providers it applies to | `{}` |
| `notifications` | An object, see below | see below |
| `walletCurrency` | One of the Wallet currencies, or null (follow the browser's locale) | null |

`notifications` keys: `includeSessions` is boolean and defaults true. `kinds` is an object with one boolean per notification kind (see the Kinds table in Notifications), all default true; a stored document with the older group switches is migrated into it. `resetLeadDays` is 1, 3 or 7 and defaults to 3 (how many days before a banked reset, or Claude usage credits, expire the notice appears). `mutedProviders` is a list of provider names and defaults to empty; it silences every notice for those providers except a broken sign-in. An invalid or missing key takes its default. See [Notifications](notifications.md).

`PUT /api/order` takes `{ providers, accounts }`: `providers` is a list of provider names and `accounts` maps a provider to a list of connection ids. It needs a session and returns `400 invalid_body` for a duplicate or unknown provider, or a connection id that is duplicated, unknown or on another provider. Partial input is allowed: providers not listed follow the listed ones in default order, and connections not listed follow the listed ones within their provider. All writes happen in one transaction, so a rejected request changes nothing. The response is the full effective order, `{ providers, accounts }`, with `accounts` holding every provider that has connections. A new connection has no position and lands last in its provider; reconnect and disconnect leave the other positions alone.

The scheduler reads `refreshIntervalMinutes` on every tick, so a change applies without a restart. The overview reports it as `refreshIntervalMs`. It reads `historyRetentionDays` each time it prunes, so that change needs no restart either (D29).

## Wallet

Every Wallet route needs a session; the mutating ones also pass the cross-site guard. Each one returns the whole Wallet, `{ costs, topUps }`. `costs` maps a connection id to its cost; a connection missing from it is Not set. `topUps` lists every top-up, newest date first.

- A cost is `{ kind: "paid", price, cycle, renewsOn }`, `{ kind: "free" }` or `{ kind: "included", includedWith }`. `price` is `{ minor, currency }` with a positive integer `minor`. `cycle` is `monthly` or `annual`. `renewsOn` is a `YYYY-MM-DD` day or null. `includedWith` is 1 to 80 characters.
- A top-up is `{ id, connectionId, date, kind, price, credits, note, source, expiresOn, expiryAlertDays }`. A `paid` top-up needs `price`, except a `detected` one, which may stay unpriced; a `free` one has `price: null`. `credits` is a positive number or null. `note` is at most 200 characters or null. `source` is `owner` or `detected`; the server sets it and a client cannot. `expiresOn` is a `YYYY-MM-DD` day or null, `expiryAlertDays` is 7, 14, 30 or null and needs `expiresOn`. The server assigns `id`.

`PUT /api/wallet/costs/:connectionId` and `POST /api/wallet/top-ups` return `400 invalid_body` for a value outside these rules and `404 unknown_connection` for a connection that does not exist. `POST /api/wallet/top-ups` always records an owner entry.

`PUT /api/wallet/top-ups/:id` takes `{ date, kind, price, credits, note, expiresOn, expiryAlertDays }` and replaces those fields; the account and the source stay. It answers with the whole Wallet. `400 invalid_body` covers a value outside the rules, including an owner entry that is `paid` without a price or `free` with one. An unknown id is `404 unknown_top_up`. The two `DELETE` routes succeed when the entry is already gone. The display currency is the `walletCurrency` setting. Demo Mode never calls these routes: its Wallet lives in the browser's memory.

## Automations

Both routes need a session and the cross-site guard. The rules and the ADR behind them are in [ADR 0003](../decisions/0003-owner-automations.md).

`PUT /api/connections/:id/auto-reset` takes `{ enabled, window, thresholdPercent, minHoursLeft }`: `window` is `weekly`, `session` or `either`, `thresholdPercent` is 90, 95 or 100, `minHoursLeft` is 1, 3, 6, 12, 24 or 48. It answers `{ autoReset }`. `DELETE` answers `{ autoReset: null }`. Errors: `400 invalid_body`, `404 unknown_connection`, and `409 unsupported_action` when the provider's connector cannot consume a reset credit. A saved rule does nothing while "Allow Account Actions" is off.

`PUT /api/connections/:id/budgets/:metricKey` takes `{ amount }`, a positive number up to 1,000,000,000. The unit is not in the request: the server copies it from that metric in the latest snapshot. It answers `{ budgets }`, every budget of that account. `DELETE` clears one budget and answers the same shape. Errors: `400 invalid_body`, `404 unknown_connection`, and `409 not_a_spend_metric` when the latest snapshot has no metric of kind `spend` with that key, or its unit is not a notification amount unit.

## Account actions gate

Account actions are off by default and run only after the owner switches on "Allow Account Actions" in Settings (`accountActions`) and confirms each action. With the setting off, the action route answers `403 actions_disabled`. The confirm literal, connection state and usable-credit checks still apply. An owner-configured auto-reset rule goes through the same service with `origin: automation` and needs the same setting. See [the data model](data-model.md#actions).

## Delivery

Server-side notification channels; behavior in [notifications](notifications.md#delivery). All routes need a session, and writes pass the cross-site guard. No response carries a bot token, chat id, webhook URL or signing secret, except the webhook secret returned once by create (when the client did not supply one) and rotate. Errors are `{ "error": "<code>" }`, `invalid_body` (400) for a body that fails validation and `not_found` (404) for an unknown channel.

A webhook `secret` is `whsec_` plus base64 of at least 24 bytes (`^whsec_[A-Za-z0-9+/]{32,}={0,2}$`).

`ChannelView`:

```json
{
  "id": "…",
  "type": "telegram",
  "enabled": true,
  "includeIdentity": false,
  "label": "@my_bot · Ops",
  "createdAt": 1790000000000,
  "lastDelivery": { "status": "delivered", "at": 1790000000000, "failure": null }
}
```

`label` is a display summary: `@botusername` and the chat title when known for Telegram, the URL host only for a webhook. `lastDelivery` is the latest attempt on the channel or null. `status` is `notification.delivery.status`, `failure` is `notification.delivery.failure` or null.

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/delivery/channels` | | `{ channels: ChannelView[] }` |
| `POST /api/delivery/channels` | `{ type: "telegram", botToken, chatId, chatTitle?, includeIdentity? }` or `{ type: "webhook", url, secret?, includeIdentity? }` | `201 { channel }`; a webhook without a client `secret` adds a generated `secret`, shown once. With a client `secret`, the response has none |
| `PATCH /api/delivery/channels/:id` | Any of `enabled`, `includeIdentity`, and for Telegram `botToken`, `chatId`, `chatTitle`, for a webhook `url`, `secret` | `{ channel }`. Telegram `chatId` and `chatTitle` change without a token |
| `DELETE /api/delivery/channels/:id` | | `204`, deletes the channel and its delivery records |
| `POST /api/delivery/channels/:id/test` | | `{ ok: true }`, or `502 { error: <failure class> }`. Not recorded as a delivery |
| `POST /api/delivery/channels/:id/secret` | | `{ secret }`; webhook only (`400 unsupported_channel` otherwise). The old secret stops working |
| `POST /api/delivery/telegram/bot` | `{ botToken }` | `{ bot: { username, name } }`. A rejected token is `400 telegram_token_rejected`, another failure `502 { error: <failure class> }` |
| `POST /api/delivery/verify` | `{ type: "telegram", botToken, chatId }`, `{ type: "telegram", channelId, chatId }` or `{ type: "webhook", url, secret }` | `{ ok: true }`, or `502 { error: <failure class> }`. Sends a test and saves nothing. `404` for an unknown `channelId`, `400 unsupported_channel` for a webhook channel |
| `POST /api/delivery/telegram/chats` | `{ botToken }` or `{ channelId }` | `{ bot: { username }, chats: [{ id, title, type }] }` |

Validation: a Telegram `botToken` matches `^\d{5,}:[A-Za-z0-9_-]{30,}$`, a `chatId` is a number or `@name`, `chatTitle` is at most 128 characters, a webhook `url` is `http:` or `https:` without credentials. Creating a channel, changing its token and discovering chats call Telegram `getMe`. A token Telegram refuses is `400 telegram_token_rejected`. A timeout, network error, rate limit or Telegram server error is `502` with the failure class. Chat discovery shows chats that wrote to the bot in the last 24 hours.
