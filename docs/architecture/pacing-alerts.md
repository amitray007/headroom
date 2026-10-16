# Pacing alerts (plan)

Status: proposal, not implemented. Written 2026-10-16 on branch `fix/notification-repeats`. Labels: **[verified]** was read in code or docs on this date; **[proposal]** is new design; **[unvalidated]** is provider behavior no one has checked live.

## Problem

Running Low and Almost Out look only at percent left. They ignore time. A meter with 20% left and 3 hours to its reset is fine. A meter with 20% left and 3 days to go is not. A pacing alert compares the burn rate with the time left and says so: "At this rate Claude's weekly limit runs out in about 6 hours, 2 days before it resets." It is a read-only calculation on stored readings. It makes no model request and changes no account.

## 1. What data exists

**Meters [verified in connectors and `packages/view-model/src/accounts.ts`].**

| Provider | Percent meters | Reset time | Window length |
| --- | --- | --- | --- |
| Claude | `five_hour`, `seven_day`, `seven_day_sonnet`, `limits.*` weekly scoped | `resets_at`; null on an idle 5-hour session | scope `window:18000s` or `window:604800s` |
| Codex | `rate_limit.primary_window`, `secondary_window`, `additional.*` | `reset_at`, else observed time plus `reset_after_seconds` | scope `window:<limit_window_seconds>s` |
| Cursor | `included.total_percent`; Grok-bot percent | cycle end; `nextResetTimestampUtc` | `billing_cycle` (start and end); `window:<s>s` |
| Grok | weekly pool and product shares | window end | `window:weekly` with start and end |
| Antigravity | `quota.gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly` | `resetTime` | known buckets carry `window:18000s` or `window:604800s`; an unknown bucket has scope `window` (length unknown) |
| Copilot | `credits.used_percent` | `quota_reset_date` | scope `month`; `lengthOf` derives it from the reset date |
| Vercel AI Gateway | none | - | - |

`meterWindows()` already returns `seconds`, `start`, `end` and `kind` (`session`, `weekly`, `cycle`, `other`) for every meter. A meter with unknown length has `seconds: null`.

**Sliding windows.** Codex sets `resetsAt = observedAt + reset_after_seconds` when it has no `reset_at` [verified, `resetsAtOf`], so the reset time moves with every reading of an unused window. Claude's 5-hour clock starts on first use [verified, `resetWordsOf` shows `not_started`]. That Codex and Antigravity weekly windows also start on first use is a prior observation [unvalidated].

**Cadence and retention [verified].** The scheduler refreshes every `refreshIntervalMinutes` (5, 10, 15 or 30; default 900 s = 15 min, `config.ts`). Each run that observes anything writes one `snapshots` row with one `metrics` row per meter (`SnapshotStore.record`). Failed runs write no snapshot, so a failure is a gap. Snapshots are kept `historyRetentionDays` (30 to 365, default 90), and the newest one per account is always kept (D29). One weekly meter has about 96 readings per day at 15 minutes.

**What the derive path sees [verified].** `NotificationDispatcher.dispatch` calls `overview(now)` (`overviewConnections`), then `derive(connections, settings, now, topUps)`. The overview holds the latest snapshot, the last run, 7 days of account events and automation settings. It holds no earlier readings. The browser bell calls the same `deriveNotifications`. `GET /api/history` (`createHistoryReader`) keeps hourly maxima per limit for Analytics. It is built for charts, belongs to the route, and has no raw 15-minute points, so it is not the input here.

**What pacing needs [proposal].** A trail of recent raw readings per eligible meter: `(observedAt, usedPercent, resetsAt)`. The server must attach a small summary to the overview, as it already does for `events` and `automation`. Then the bell and the server deliver the same alert, and `derive` stays pure and synchronous.

## 2. Burn-rate method [proposal]

**Eligible meters.** Window `kind` is `weekly` or `cycle`, length known, not unlimited, `resetsAt` in the future, reading `available` with a number. Sessions (6 hours or less) are excluded: they are bursty and reset soon, and Running Low already covers them. `other` has no known length.

**Unit.** Let `L` be the window length and `U = L / 7`. For a weekly window `U` is 1 day. For a 30-day cycle it is about 4.3 days. `U` sets the trailing span, the lead and the re-send step, so there is one tunable.

**Trail.**

1. Take the readings of one `(metric key, scope)` from the last `U` before the newest reading. The query uses the `snapshots(connection_id, observed_at)` index.
2. Keep one period only. Group by reset time as `history.ts` does (ends within 10 minutes are one window). Cut the trail at the last reading whose end differs from the newest end by more than 10 minutes, and at the last drop of more than 1 point in used percent. That handles a reset in the window and an early reset. It also removes readings of a window whose reset time was still sliding before first use.
3. Keep only readings that are `available` with a number. A missing reading is skipped, never counted as 0.

**Unknown (no alert) unless all of these hold.**

- At least 4 readings, spanning at least `0.75 U`. The span then includes some idle hours, so a night does not hide in a busy-day rate.
- The newest reading is at most `max(3 x refresh interval, 1 hour)` old.
- Usage gained at least 2 points across the trail (noise floor), and at least 1 point in the last `U / 4` (idle gate). An idle account projects nothing.

**Rate and run-out.**

```
r        = (u_last - u_first) / (t_last - t_first)      points per hour
T_out    = t_last + (100 - u_last) / r
earlyBy  = resetsAt - T_out
```

The rate uses the two ends of the trail, not a fit, so jitter in the middle and gaps from failed refreshes do not move it. `u` is used percent. A meter over 100 projects `T_out = t_last` and is already Almost Out.

**Known weakness.** A trailing rate predicts the next days from the last day. A heavy day followed by a day off makes it too high. The idle gate and the lead below reduce false alarms; they do not remove them.

## 3. Trigger rule [proposal]

Raise `pacing` for a meter when all of these hold:

- The pace is known (section 2).
- `earlyBy >= U`. For a weekly window, it runs out at least a day early.
- The meter is not yet Running Low: percent left is at least `lowThresholdPercent` (30, 20 or 15). Below that line Running Low takes over (see the hand-off below).
- Provider is not muted, the connection is `ready` or `partial`, and `notifications.kinds.pacing` is on. `includeSessions` has no effect.

Tone is `warn`. `bad` stays with Almost Out.

**Dedupe id [proposal].** `<connectionId>:pacing:<metricKey>:<periodEnd>:<level>`.

- `periodEnd` is the meter's stored reset time. Stored reset times stay steady within one period (D40), so provider jitter cannot change the id.
- `level = 1 + floor((earlyBy - U) / U)`, from 1 to 7. The alert sends when level 1 is first reached, and again only when the run-out moves one more `U` earlier (a weekly meter: 1, then 2, then 3 days early). A period sends at most 7 and usually 1 or 2.
- If the projection improves, the level falls to an id that was already sent, so nothing repeats. One edge case: a jump from level 1 to 3 followed by a drop to 2 would send level 2 once, because the derivation keeps no memory. That is a bounded extra message. A ratchet in the dispatcher would remove it; it is not worth the state.
- The text can change between passes while the id holds. The first delivered text stands; the bell shows the current one.

**Hand-off with Running Low and Almost Out.** The owner gets one message per situation:

- While left is at or above the threshold, only `pacing` can speak.
- Once left falls below the threshold, `pacing` is no longer derived. Running Low or Almost Out fires as today, with its id unchanged. When a pace is known and `earlyBy >= U`, that message adds the pace sentence ("At this rate it runs out in about 6 hours, 2 days before it resets."). No second event, no second send.
- Running Low steps (a repeat at each further 10 points used, D40) keep their own ids. The hand-off boundary is the first Running Low step.
- Out of scope here: hiding Running Low when the pace is safe (20% left, 3 hours to go). See the open questions.

## 4. Settings [proposal]

One new kind, `pacing`, with one switch at `notifications.kinds.pacing`, default `true` like every kind. No sensitivity setting in v1: `U` and the gates are constants.

A new kind must be added together in:

- `packages/core/src/enums.ts` (`notificationKinds`);
- the `notification.kind` row in `docs/architecture/data-model.md`;
- the Kinds table in `docs/architecture/notifications.md`.

`kindSwitches` and `mergeKinds` loop over `notificationKinds` [verified], so no other settings code changes, and a stored document without the key loads with `pacing: true`. The Settings Notifications tab gets a "Pacing" switch under "Limits".

## 5. Event schema, text, webhook [proposal]

`notificationEventSchema` is strict [verified]. Add one optional field to `figures`: `runsOutAt` (epoch ms, the projected `T_out`). `schemaVersion` stays 1 because the change is additive. Upgrade Headroom before any code that builds the event.

```json
{
  "schemaVersion": 1,
  "id": "c1:pacing:seven_day:1790200000000:1",
  "kind": "pacing",
  "tone": "warn",
  "occurredAt": 1789990000000,
  "observedAt": 1789990000000,
  "provider": "claude",
  "connection": { "id": "c1", "name": "Personal", "plan": "max_5x" },
  "subject": { "metricKey": "seven_day", "label": "Weekly", "window": "all models" },
  "figures": { "percentUsed": 62, "percentLeft": 38, "resetsAt": 1790200000000, "runsOutAt": 1790012000000 },
  "title": "Claude Weekly Limit Will Run Out Early",
  "message": "38% left. At this rate it runs out in about 6 hours, 2 days before it resets.",
  "links": {}
}
```

Telegram text uses the existing template [verified in `format.ts`]:

```
<b>Claude Weekly Limit Will Run Out Early</b>
38% left. At this rate it runs out in about 6 hours, 2 days before it resets.
Claude · Personal · Max 5x
<a href="...">Open Headroom</a>
```

Durations are words: hours under 48, days above, always "about". The server forces countdown style, so no time zone is needed. `limitsView: "used"` shows "62% used."

Webhook: the body shape and signing do not change. Receivers see a new `kind` value, a new `x-headroom-event: pacing` header, and the extra `figures.runsOutAt`. A receiver that switches on `kind` must ignore an unknown value. `webhook-id` hashes the event id, so a new level is a new message. Document this in the Webhook section.

Overview: add `pace` to `overviewConnectionSchema`, default `[]`, like `events` [verified pattern]. Each entry: `{ metricKey, periodEnd, ratePerHour, from, readings }`. `derive` computes `T_out` from the meter's current used percent and `ratePerHour`. Document it in `api.md`.

## 6. Open questions for the owner

1. Is "at least one window-day early" the right lead? A shorter lead warns sooner and nags more.
2. Exclude billing cycles (Cursor, Copilot)? Running out of included usage there may roll into on-demand spend rather than stop work.
3. Should Running Low be hidden when the pace says the reset comes first (20% left, 3 hours to go)? It changes today's behavior, so v1 leaves it.
4. Add the pace sentence to Running Low and Almost Out messages, or keep pacing a separate message only?
5. Show the same pace in the UI (a marker on the meter)? This plan covers notifications only.
6. Sliding-window providers: confirm live that Codex and Antigravity weekly resets start on first use. Until then the trail cut handles it, but it is unvalidated.

## Implementation outline [proposal]

1. `packages/view-model/src/pacing.ts` (new, pure): `paceOf(trail, window, now, refreshMs)` returns a pace or `null`; `runsOutAt(used, pace)`; level and duration helpers.
2. `packages/core/src/readings.ts` (new): one query for recent percent readings of given accounts since a time (same `usable` filter as `history.ts`).
3. `apps/server/src/overview-model.ts`: fill `pace` for eligible meters, cached per account by newest snapshot id so repeated overview polls do not re-read.
4. `packages/view-model/src/overview.ts`: `pace` schema. `demo.ts`: seeded pace so Demo Mode shows the alert.
5. `packages/view-model/src/notifications.ts`: `pacingNotifications`, the hand-off check in `limitNotifications`, the ordering in `deriveNotifications`.
6. `packages/core/src/enums.ts`, `notification-event.ts` (`runsOutAt`), settings tab in `apps/web`.
7. Docs: `notifications.md`, `data-model.md`, `api.md`, a D41 row in `decisions/README.md`, this plan folded in and deleted, and the docs index in `docs/README.md`.

Tests:

- `pacing.test.ts`: steady burn; fewer than 4 readings; short span; stale newest reading; gap from failed refreshes; drop mid-window; early reset; idle account; sliding reset time before first use; unlimited, unknown and unavailable readings; session and unknown-length windows excluded; cycle windows; level steps.
- `notifications.test.ts`: raised at the lead and not below it; not raised under the Running Low line; hand-off sentence and unchanged Running Low id; muted provider and switch off; unknown pace gives nothing.
- `dispatcher.test.ts`: one send per level, a resend on the next level, none on an improved projection.
- Core: readings query ranges and cache invalidation on a new snapshot. Settings: an old document loads with `pacing: true`. Schema: `runsOutAt` accepted, unknown fields still rejected.
- Run `mise run check` before calling it done.
