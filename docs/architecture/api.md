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
| `DELETE /api/connections/:id` | Disconnect and delete local data |
| `GET /api/providers`, `/api/attempts/...` | Connect flow, see [the connection lifecycle](connections.md) |
| `GET /api/settings`, `PUT /api/settings` | Owner preferences |
| `PUT /api/order` | Owner-defined order of providers and of accounts within a provider |
| `/api/delivery/...` | Notification channels (Telegram, webhook), tests and Telegram chat discovery, see [Delivery](#delivery) |

## Overview

`GET /api/overview` returns `{ connections, providerOrder, refreshIntervalMs, staleAfterMs }`. `providerOrder` lists every provider in the owner's effective order. Connections follow it, then the owner's account position (unpositioned last), then creation time. `GET /api/connections` uses the same order. Each entry holds:

- `id`, `provider`, `scope`, `state`, `reconnectReason`, `interface`, `authMethod`, `createdAt`, `lastSuccessAt`, `stale`.
- `name`: the owner-set display name, or null.
- `identity` and `plan`: the stored label split by `splitLabel` in `packages/core/src/label.ts`. The identity is the text before a trailing ` (<plan>)`. It is null when empty or when it equals the generic fallback label of the provider (for example `Codex`). The plan is null when absent or when it only repeats the product name, as in the Copilot label `<login> (Copilot)`.
- `latestRun`: `{ startedAt, finishedAt, outcome, error, failureStreak }` or null. `outcome` is null while a run is in flight. `failureStreak` counts the most recent finished runs, newest first, that failed in a row (0 to 5; a run in flight is ignored).
- `snapshot`: `{ observedAt, metrics, resetCredits }` or null. Metrics and reset credits have the same fields as in the detail route.
- `actions`: `{ enabled, supported }`, where `enabled` is the effective gate.

The response carries no provider account id or workspace id. The detail route is built field by field for the same reason.

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
| `accountActions` | boolean | false |
| `notifications` | An object, see below | see below |

`notifications` keys: `runningLow`, `expiringResets`, `refreshFailures`, `balances`, `spend` and `includeSessions` are boolean and default true. `resetLeadDays` is 1, 3 or 7 and defaults to 3 (how many days before a banked reset expires the notice appears). `mutedProviders` is a list of provider names and defaults to empty; it silences every notice for those providers except a broken sign-in. An invalid or missing key takes its default. See [Notifications](notifications.md).

`PUT /api/order` takes `{ providers, accounts }`: `providers` is a list of provider names and `accounts` maps a provider to a list of connection ids. It needs a session and returns `400 invalid_body` for a duplicate or unknown provider, or a connection id that is duplicated, unknown or on another provider. Partial input is allowed: providers not listed follow the listed ones in default order, and connections not listed follow the listed ones within their provider. All writes happen in one transaction, so a rejected request changes nothing. The response is the full effective order, `{ providers, accounts }`, with `accounts` holding every provider that has connections. A new connection has no position and lands last in its provider; reconnect and disconnect leave the other positions alone.

The scheduler reads `refreshIntervalMinutes` on every tick, so a change applies without a restart. The overview reports it as `refreshIntervalMs`.

## Account actions gate

Account actions are off by default and run only after the owner switches on "Allow Account Actions" in Settings (`accountActions`) and confirms each action. With the setting off, the action route answers `403 actions_disabled`. The confirm literal, connection state and usable-credit checks still apply. See [the data model](data-model.md#actions).

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
