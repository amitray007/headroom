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

## Overview

`GET /api/overview` returns `{ connections, refreshIntervalMs, staleAfterMs }`. Connections are ordered by the provider order in `packages/core/src/enums.ts`, then by creation time. Each entry holds:

- `id`, `provider`, `scope`, `state`, `reconnectReason`, `interface`, `authMethod`, `createdAt`, `lastSuccessAt`, `stale`.
- `name`: the owner-set display name, or null.
- `identity` and `plan`: the stored label split by `splitLabel` in `packages/core/src/label.ts`. The identity is the text before a trailing ` (<plan>)`. It is null when empty or when it equals the generic fallback label of the provider (for example `Codex`). The plan is null when absent or when it only repeats the product name, as in the Copilot label `<login> (Copilot)`.
- `latestRun`: `{ startedAt, finishedAt, outcome, error }` or null. `outcome` is null while a run is in flight.
- `snapshot`: `{ observedAt, metrics, resetCredits }` or null. Metrics and reset credits have the same fields as in the detail route.
- `actions`: `{ enabled, supported }`, where `enabled` is the effective gate.

The response carries no provider account id or workspace id. The detail route is built field by field for the same reason.

## Display name

`PATCH /api/connections/:id` takes `{ "name": string | null }`. The server trims the text. An empty string or null clears the name. More than 40 characters after trimming is `400 invalid_body`. An unknown id is `404`. The response is `{ "name": string | null }`.

## Settings

`GET /api/settings` returns `{ settings, actionsAllowedByServer }`. `PUT /api/settings` takes the full settings object, validates it against `settingsSchema` and returns the same shape, or `400 invalid_body`.

| Key | Values | Default |
| --- | --- | --- |
| `limitsView` | `used`, `left` | `used` |
| `lowThresholdPercent` | 30, 20, 15 (percent left below which a limit reads "running low") | 30 |
| `refreshIntervalMinutes` | 5, 10, 15, 30 | the option nearest to `HEADROOM_REFRESH_INTERVAL_SECONDS` |
| `timeStyle` | `countdown`, `exact` | `countdown` |
| `clock` | `24h`, `12h` | `24h` |
| `density` | `comfortable`, `compact` | `comfortable` |
| `accountActions` | boolean | false |
| `notifications` | `runningLow`, `expiringResets`, `refreshFailures`, all boolean | all true |

The scheduler reads `refreshIntervalMinutes` on every tick, so a change applies without a restart. The overview reports it as `refreshIntervalMs`.

## Account actions gate

Account actions run only when the `HEADROOM_ENABLE_ACTIONS` flag and the owner's `accountActions` setting are both true. `actionsAllowedByServer` reports the flag; the owner cannot change it from the browser. With either half off, the action route answers `403 actions_disabled`. The confirm literal, connection state and usable-credit checks still apply. See [the data model](data-model.md#actions).
