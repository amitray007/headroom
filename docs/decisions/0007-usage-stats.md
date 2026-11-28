# ADR 0007: Anonymous usage stats and the update notice

Status: accepted on 2026-11-28 by the owner.

## Context

The maintainer cannot see how many installs run, which versions they run, which connectors they use or which ones fail. Owners also miss new releases: only the Mac app and `headroom update` check for one, and the web dashboard says nothing.

Headroom holds provider credentials, so anything it sends out must carry no account data and must be easy to turn off.

## Decision

- The server sends anonymous events to PostHog Cloud with the public project key in `apps/server/src/telemetry.ts`. They go in one request to `/batch/` through PostHog's managed reverse proxy at `hd.headroom.theblank.club`, so DNS blocklists that list `posthog.com` do not drop them. The browser and the Mac app never call PostHog. An empty key sends nothing.
- Each event carries a random install ID, kept in `<data dir>/install-id`, as `distinct_id`, a fresh `uuid` so PostHog drops a duplicate, and `schema` (now 1), raised when a property changes meaning. Daily events also carry `window_start`, `window_end` and `window_hours`, the period their counts cover. Values are flat, so PostHog can break down and sum them without SQL:
  - `install_active`, once a day and on each start: `version`, `os` (for example `linux-x64`), `install` (`docker`, `homebrew`, `npm`, `python`, `app` or `standalone`), `account_total`, `providers` (the providers with linked accounts), `enabled_providers` (the connectors `HEADROOM_ENABLED_PROVIDERS` turns on), `mac_clients` (the Mac app and widget versions that read the feed, from the start of their User-Agent, such as `Headroom/1.2.0`) and `feature_*`: `account_actions` (on or off), counts of enabled `auto_reset_rules`, `spend_budgets`, `wallet_costs`, `wallet_top_ups`, enabled `channels_telegram` and `channels_webhook`, the `refresh_minutes` and `history_days` settings, and the display and notification settings: `limits_view`, `low_threshold_percent`, `time_style`, `clock`, `density`, `detailed_order`, `keep_inactive_last`, `wallet_currency` (or `auto`), `notification_kinds_on` (a count), `notification_sessions`, `notification_lead_days` and `muted_providers` (a count). It also carries `latest_version` (the newest release the update notice has seen, or null) and `update_available`, so PostHog shows how fast installs move to a new release.
  - `provider_daily`, once a day for each provider with accounts or refreshes: `version`, `provider`, `accounts`, `refreshes`, `refresh_failed`, one `refresh_<outcome>` count per sync run outcome seen since the last one, and one `metrics_<availability>` count per metric availability in each account's newest reading. Many `metrics_unknown` point at a broken private endpoint.
  - `plan_daily`, once a day per provider and plan tier: `version`, `provider`, `plan` and `count`. The tier keeps only known words such as `pro`, `max` or `20x` from the account label; anything else, such as a workspace name, becomes `other`.
  - `connect_result`, once a day, one per sign-in attempt that finished since the last one, up to 50: `version`, `provider`, `method` and `state`.
  - `action_result`, once a day, one per account action that ended since the last one, up to 50: `version`, `provider`, `action`, `origin` (`owner`, `automation` or `expiry`) and `state`.
  - `delivery_daily`, once a day per channel type and result: `version`, `channel` (`telegram` or `webhook`), `status`, `failure` (a delivery failure class or null) and `count`.
  - `server_error`, once a day per place and error class: `version`, `where` (the first word of the error log line, or `request` for a failed request), `error` (the class name, such as `TypeError`) and `count`. No message text, id or path is kept.
  - `opened`, at most once an hour, only when the owner looked at Headroom since the last one: `version`, `surfaces` (a list of `web`, `mac` and `mcp`), `views` (the dashboard pages opened: `overview`, `detailed`, `compare`, `timeline`, `wallet`, `analytics`, `connect`) `actions` (owner presses: `update_opened` when the update notice opened the release notes) and `mcp_tools` (the MCP tools agents called: `status`, `history`).
  - `$exception`, at most once an hour per error class and place, for PostHog error tracking: `version`, `count`, `where` (such as `collect`, `request POST` or `render`), `source` (`server` or `web`) and `$exception_list` with the class and stack frames. Frames keep function names, line numbers and source paths cut to the part inside the Headroom tree. The error message is never sent, since it can echo a provider response. The web app reports render failures, uncaught errors and unhandled rejections through `POST /api/usage/error`; the server cleans the stack before anything leaves it.
  - `feedback`, only when the owner sends a message from Settings or the avatar menu: `version` and the message as typed, at most 2,000 characters. It is an explicit press, so it goes out even with usage stats off; then it carries a one-off ID instead of the install ID, so it cannot be joined to earlier events. The server accepts one message every 30 seconds.
- Outside the server, two more sources send to the same project:
  - The installer (`site/install.sh`) sends one `install_script` event after a successful install. Its `distinct_id` is the server's install ID: the installer reads it from the data directory that `headroom paths` names, or writes a new one there, so one install keeps one ID from download to daily use. The event carries `os`, `arch` and the `version` asked for (`latest`, a version number, or `custom`). `HEADROOM_TELEMETRY=false`, `DO_NOT_TRACK=1` and a custom `HEADROOM_DOWNLOAD_BASE` skip it. It waits at most 3 seconds and never fails the install.
  - The public site and the static demo load PostHog's browser library with memory-only persistence and exception capture, so nothing is stored in the visitor's browser: page views, `install_copied` with `method`, `github_clicked` with `place`, `demo_view` with `view` and `embedded`, and `demo_deploy_clicked`. Each event carries `source` (`site` or `demo`). A self-hosted build contains none of this code.
- Every value except the feedback message is a count, a flag or a fixed enum value. Nothing else is sent: no account emails, logins or IDs, no credentials, balances, limits, usage figures, error text, host names or provider responses.
- The `usageStats` setting, "Share Usage Stats" on the Privacy tab of Settings, is on by default and the owner can switch it off. `HEADROOM_TELEMETRY=false` turns the pings off whatever the setting says. Both are read at send time, so a change needs no restart.
- A failed send is dropped and never retried, and it never shows an error.
- `<data dir>/usage-watermark` records when activity was last reported, or kept back while usage stats were off. A restart never reports the same sign-ins or refreshes twice, and switching usage stats back on never reports the time they were off. The daily window is at most one day.
- The update notice is separate from the pings. `GET /api/version` asks GitHub's latest-release API at most once a day and returns the running version and a newer release with its notes page. The avatar menu then shows "Update to X.Y.Z", which opens the release notes. This check sends nothing about the install and works with the pings off.

## Alternatives

- A receiver on the maintainer's own server: more to run and secure, and no charts without building them.
- Self-hosted PostHog: needs ClickHouse and Kafka, far more than five event types need.
- Nested objects such as `{ codex: 2 }`: PostHog cannot break them down or sum them without SQL.
- An email field on feedback: the owner can write one into the message if they want a reply.
- A 15-minute heartbeat for live counts: about 2,900 events per install a month, which uses PostHog's free million events at about 350 installs. The hourly `opened` event answers "who used it recently" for a fraction of that.
- Opt-in: most owners never change a default, so the counts would mean little.
- The browser library inside the self-hosted dashboard: it would send page URLs and stack traces with the owner's host name, and ad blockers would drop it. The server forwards cleaned web errors instead.

## Consequences

- PostHog shows daily active installs (unique `install_active` IDs), installs opened in the last hour, version spread, install methods, connector popularity, sign-in and refresh failure rates per provider, feature use and the owner's feedback.
- An owner who removes `install-id` counts as a new install.
- PostHog's free plan keeps raw events for one year. A batch export to S3-compatible storage, such as Cloudflare R2, keeps them longer; the first million exported rows a month are free. See [Usage stats in PostHog](../operations/usage-stats.md#keep-the-data).
- An owner behind a firewall that blocks PostHog loses nothing: the send fails quietly.
- A new property needs an update to this record, to the README, to [Usage stats in PostHog](../operations/usage-stats.md) and to `telemetry.test.ts`, which asserts the exact payload.
