# ADR 0003: Owner automations and detected account events

Status: accepted on 2026-10-04 by the owner. Amends the monitoring rule in [AGENTS.md](../../AGENTS.md) and D23.

## Context

Headroom read accounts and acted only when the owner pressed a button. The owner asked for four more things:

- Use a banked Codex reset automatically when a limit runs out.
- Record credit top-ups without typing them in.
- Hear about a new banked reset, or a limit that came back before its reset time.
- Get alerts for on-demand spend, for budgets they set themselves, and for Wallet credits that expire.

Every provider that sells credits already offers its own auto top-up (Vercel, Codex, Claude, xAI). Headroom never buys credits.

## Decision

### Account events

The collector compares each new reading with the previous one for the same account. When something changed, it writes an `account_events` row. The detail holds numbers and ids only, never provider text. Events are pruned with sync history (D29). Kinds (`accountEventKinds`):

| Kind | Fires when | Providers |
| --- | --- | --- |
| `reset_granted` | A usable reset credit appears whose id was not in the previous reading, the usable count rose, and both readings report the inventory. Claude grant ids are positional, so for Claude a grant is new only when its expiry is new too | Codex, Claude |
| `early_reset` | A percent limit fell from 10% used or more to 5% or less, a drop of at least 10 points, while the previous reading still put its reset more than 10 minutes away. Any action since the previous reading that has not failed explains the drop, so the event is skipped. That includes an action still in flight, because its follow-up collection runs before the row is marked `succeeded` | Every provider with percent limits |
| `top_up_detected` | A credit balance rose by at least 0.01 of its unit. Headroom also records a Wallet top-up for it | Codex `credits.balance`, Grok `prepaid_balance`, Vercel AI Gateway: the granted total (`credits.balance` plus `credits.total_used`), else `credits.balance` |
| `auto_reset` | An auto-reset rule fired. The detail names the action and its final state | Codex |

Nothing is detected without a previous reading, or when the value was unknown or unavailable in either reading. Unknown is not zero.

### Detected top-ups

A detected top-up is a Wallet row with `source: "detected"`:

- `kind`: `paid`, with no price until the owner adds one.
- `credits`: the rise.
- `date`: the UTC day of the reading.

Totals leave out a paid top-up that has no price, and count it as "price not set". The owner can edit the row, give it a price or change it to free, and it keeps its `detected` mark. The owner can also delete it. A promotion or refund also raises a balance; editing or deleting covers that case.

### Auto-reset

One rule per account (`auto_reset_rules`), for providers whose connector supports `consume_reset_credit`. The rule has these fields:

- `enabled`
- `window`: `weekly` watches windows of 7 days or more. `session` watches windows of 5 hours or less. `either` watches both. The window length is the metric scope `window:<seconds>s`.
- `thresholdPercent`: 90, 95 or 100.
- `minHoursLeft`: 1, 3, 6, 12, 24 or 48.

After each scheduled collection that succeeded, the scheduler evaluates the rule. It fires only when all of these hold:

1. The owner's "Allow Account Actions" setting is on. The rule is a standing owner action and still needs the D23 gate.
2. The connection is `ready` or `partial`.
3. A watched `rate_limit.*` window is at least `thresholdPercent` used, and its own reset is known and more than `minHoursLeft` hours away. Model-specific limits are not watched.
4. A reset credit is usable. The one that expires first is used, and one with no expiry goes last.
5. No automatic action for this account started inside the current instance of any qualifying window. An instance runs from `resetsAt` minus the window length. When several windows qualify, the longest is reported. A failed or `uncertain` attempt therefore blocks retries until the window resets on its own. A successful reset starts a new instance.

The rule calls the action service with `origin: "automation"`. The service creates the action row, uses its id as the idempotency key, holds the lease, and records `uncertain` explicitly. After the action, Headroom writes an `auto_reset` event.

The consume route is still unvalidated. The owner accepted that: if the first automatic call fails, the endpoint gets fixed and the rule keeps working. Agents never enable a rule or run a consume with real credentials.

### Budgets

The owner can set a budget on any `spend` metric of an account, in that metric's unit, in `spend_budgets`. The current spend metrics are:

- Cursor `on_demand.used`
- Claude `extra_usage.used`
- Grok `on_demand.used`
- Vercel AI Gateway `spend.30d`

A budget is the owner's own number. The provider's cap still raises `spend_near_cap` and `spend_cap_reached`.

### Notifications

New `notification.kind` values:

| Kind | From | Tone | Switch |
| --- | --- | --- | --- |
| `reset_granted` | `reset_granted` event in the last 72 hours | `info` | `resetActivity` |
| `early_reset` | `early_reset` event in the last 72 hours. `includeSessions` off skips windows of 5 hours or less | `info` | `resetActivity` |
| `auto_reset` | `auto_reset` event in the last 72 hours | `info` when succeeded, `warn` when failed or `uncertain` | `resetActivity`. A muted provider still shows a failed or `uncertain` attempt |
| `top_up_detected` | `top_up_detected` event in the last 72 hours | `info` | `balances` |
| `budget_near` | Spend is at least (100 minus the low threshold)% of the owner's budget | `warn` | `spend` |
| `budget_exceeded` | Spend is at least the budget | `bad` | `spend` |
| `credits_expiring` | A Wallet top-up has an expiry and an alert, today is within `expiryAlertDays` of the expiry, and the expiry has not passed | `warn` | `balances` |

`extra_usage_started` also fires when Cursor or Grok `on_demand.used`, or Claude `extra_usage.used`, is above 0.

Event-based notices use the event id in their dedupe id, so each one sends once. Every rule in [Notifications](../architecture/notifications.md) that applies to all kinds still applies.

## Consequences

- AGENTS.md now allows a mutation that an owner-configured rule starts. Monitoring alone still never generates a model request, redeems a reset or buys credits.
- `account_actions.origin` separates owner and automatic actions.
- Wallet totals gain a "price not set" count.
- The overview carries each account's events from the last 7 days and its automation settings, so the browser bell and server delivery derive the same notices.
