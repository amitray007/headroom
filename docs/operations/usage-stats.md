# Usage stats in PostHog

This guide sets up the PostHog project that receives Headroom's anonymous usage stats. It is for the maintainer. [ADR 0007](../decisions/0007-usage-stats.md) defines what is sent and why.

## Events

| Event | When | Properties |
| --- | --- | --- |
| `install_active` | Once a day and on each start | `version`, `os`, `install`, `account_total`, `providers` (list), `mac_clients` (list), `feature_*` |
| `provider_daily` | Once a day, per provider with accounts or refreshes | `version`, `provider`, `accounts`, `refreshes`, `refresh_failed`, `refresh_<outcome>` |
| `connect_result` | Once a day, one per finished sign-in, up to 50 | `version`, `provider`, `method`, `state` |
| `opened` | At most hourly, after a view | `version`, `surfaces` (list), `views` (list) |
| `feedback` | When the owner presses Send | `version`, `message` |

The `feature_*` properties are `feature_account_actions`, `feature_auto_reset_rules`, `feature_spend_budgets`, `feature_wallet_costs`, `feature_wallet_top_ups`, `feature_channels_telegram`, `feature_channels_webhook`, `feature_refresh_minutes` and `feature_history_days`. `refresh_<outcome>` uses the sync run outcomes in `packages/core/src/enums.ts`, such as `refresh_rate_limited`.

Every event is anonymous: `distinct_id` is the install ID, `$process_person_profile` is false and `$geoip_disable` is true. All events go in one request to `/batch/`.

## Set up the project

1. Create a project on PostHog US Cloud named Headroom.
2. In Project settings, turn on **Discard client IP data**. Turn off autocapture, heatmaps, session replay and surveys: Headroom sends no browser events, and these only add noise.
3. Copy the project token (`phc_…`) into `posthogKey` in `apps/server/src/telemetry.ts`. The token can only write events, so it is safe in source.

## Route events through the proxy

DNS blocklists such as Pi-hole, NextDNS and AdGuard list `posthog.com`, and they block the Headroom server as well as browsers. PostHog's managed reverse proxy is free on Cloud.

1. In Organization settings, open **Managed reverse proxy** and add `hd.headroom.theblank.club`. Keep the name neutral: names with `analytics`, `tracking`, `telemetry` or `posthog` land on blocklists.
2. Add the CNAME record that PostHog shows to the `theblank.club` DNS zone (the record for `hd.headroom`). On Cloudflare, set it to **DNS only**.
3. Wait until PostHog shows the proxy as live. `posthogUrl` in `apps/server/src/telemetry.ts` already points at `https://hd.headroom.theblank.club/batch/`.

Until the proxy is live, every send fails quietly and feedback answers `feedback_failed`.

## Describe the events

In Data management, add a description to each event and property from the table above, and set `accounts`, `refreshes`, `refresh_*`, `account_total` and the numeric `feature_*` properties to the Numeric type. Then the insight editor offers sums and averages for them.

## Build the dashboard

Create a dashboard named **Headroom usage** with these insights.

| Insight | Type and settings |
| --- | --- |
| Active installs | Trends, `install_active`, unique users, daily; add weekly and monthly series |
| Live installs | Trends, `opened`, unique users, hourly, last 48 hours |
| Versions | Trends, `install_active`, unique users, last 24 hours, breakdown `version`, shown as a table |
| Install methods and OS | Trends, `install_active`, unique users, last 24 hours, breakdown `install`, then `os` |
| Accounts by provider | Trends, `provider_daily`, sum of `accounts`, daily, breakdown `provider` |
| Refresh failure rate | Trends, A = sum of `refresh_failed`, B = sum of `refreshes` on `provider_daily`, formula `A / B`, breakdown `provider` |
| Sign-in results | Trends, `connect_result`, total count, breakdown `provider` then `state`, stacked bars |
| Feature use | SQL, below |
| Pages and surfaces | SQL, below |
| Retention | Retention, `install_active` returning `install_active`, weekly |
| Feedback | SQL, below |

Feature use, the share of active installs that use each feature in the last day:

```sql
SELECT
  count(DISTINCT distinct_id) AS installs,
  countIf(properties.feature_account_actions = true) AS account_actions,
  countIf(toInt(properties.feature_auto_reset_rules) > 0) AS auto_reset,
  countIf(toInt(properties.feature_spend_budgets) > 0) AS budgets,
  countIf(toInt(properties.feature_wallet_costs) > 0) AS wallet,
  countIf(toInt(properties.feature_channels_telegram) + toInt(properties.feature_channels_webhook) > 0) AS channels,
  countIf(length(JSONExtractArrayRaw(properties.mac_clients)) > 0) AS mac_app
FROM events
WHERE event = 'install_active' AND timestamp > now() - INTERVAL 1 DAY
```

Pages and surfaces, the installs that opened each one in the last 30 days:

```sql
SELECT view, count(DISTINCT distinct_id) AS installs
FROM events
ARRAY JOIN JSONExtractArrayRaw(properties.views) AS view
WHERE event = 'opened' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY view
ORDER BY installs DESC
```

Change `views` to `surfaces` for a second table.

Feedback, newest first:

```sql
SELECT timestamp, properties.version AS version, properties.message AS message
FROM events
WHERE event = 'feedback'
ORDER BY timestamp DESC
LIMIT 200
```

## Alerts

- In Data pipelines, add a destination (Slack, Discord, email or webhook) for the `feedback` event, so each message reaches you as it arrives.
- On the Refresh failure rate insight, add an alert for a value above 0.2. A spike for one provider often means its API changed.

## Check the setup

Start a development server with the key set and `HEADROOM_TELEMETRY` unset. Within a minute, the Activity view shows `install_active` and one `provider_daily` per linked provider. Open the dashboard and wait for the next hourly tick to see `opened`.
