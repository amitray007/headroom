# ADR 0007: Anonymous usage stats and the update notice

Status: accepted on 2026-11-28 by the owner.

## Context

The maintainer cannot see how many installs run, which versions they run, which connectors they use or which ones fail. Owners also miss new releases: only the Mac app and `headroom update` check for one, and the web dashboard says nothing.

Headroom holds provider credentials, so anything it sends out must carry no account data and must be easy to turn off.

## Decision

- The server sends anonymous events to PostHog Cloud at `us.i.posthog.com` with the public project key in `apps/server/src/telemetry.ts`. The browser and the Mac app never call PostHog. An empty key sends nothing.
- Three events. Each one carries a random install ID, kept in `<data dir>/install-id`, as `distinct_id`:
  - `install_active`, at most once a day and on each start:
    - `version`, `os` (for example `linux-x64`) and `install` (`docker`, `homebrew`, `npm`, `python`, `app` or `standalone`).
    - `accounts` (linked accounts per provider, counts only) and `account_total`.
    - `connects`: sign-in attempts that finished since the last event, counted by `provider.method.state`, for example `codex.device_code.failed`.
    - `refreshes`: refreshes that finished since the last event, counted by `provider.outcome`, for example `cursor.rate_limited`.
    - `features`: `account_actions` (on or off), counts of enabled `auto_reset_rules`, `spend_budgets`, `wallet_costs`, `wallet_top_ups`, enabled `channels_telegram` and `channels_webhook`, and the `refresh_minutes` and `history_days` settings.
    - `mac_clients`: the Mac app and widget versions that read the feed, taken from the start of their User-Agent, such as `Headroom/1.2.0`.
  - `opened`, at most once an hour, only when the owner looked at Headroom since the last one: `version`, `surfaces` (a list of `web`, `mac` and `mcp`) and `views` (the dashboard pages opened: `overview`, `detailed`, `compare`, `timeline`, `wallet`, `analytics`, `connect`).
  - `feedback`, only when the owner sends a message from Settings or the avatar menu: `version` and the message as typed, at most 2,000 characters. It is an explicit press, so it goes out even with usage stats off.
- Every event sets `$process_person_profile: false` and `$geoip_disable: true`. The PostHog project has "Discard client IP data" on.
- Every value except the feedback message is a count, a flag or a fixed enum value. Nothing else is sent: no account emails, logins or IDs, no credentials, balances, limits, usage figures, error text, host names or provider responses.
- The `usageStats` setting, "Share Usage Stats" on the Privacy tab of Settings, is on by default and the owner can switch it off. `HEADROOM_TELEMETRY=false` turns the pings off whatever the setting says. Both are read at send time, so a change needs no restart.
- A failed send is dropped and never retried, and it never shows an error.
- The update notice is separate from the pings. `GET /api/version` asks GitHub's latest-release API at most once a day and returns the running version and a newer release with its notes page. The avatar menu then shows "Update to X.Y.Z", which opens the release notes. This check sends nothing about the install and works with the pings off.

## Alternatives

- A receiver on the maintainer's own server: more to run and secure, and no charts without building them.
- Self-hosted PostHog: needs ClickHouse and Kafka, far more than three events need.
- An email field on feedback: the owner can write one into the message if they want a reply.
- A 15-minute heartbeat for live counts: about 2,900 events per install a month, which uses PostHog's free million events at about 350 installs. The hourly `opened` event answers "who used it recently" for a fraction of that.
- Opt-in: most owners never change a default, so the counts would mean little.

## Consequences

- PostHog shows daily active installs (unique `install_active` IDs), installs opened in the last hour, version spread, install methods, connector popularity, sign-in and refresh failure rates per provider, feature use and the owner's feedback.
- An owner who removes `install-id` counts as a new install.
- An owner behind a firewall that blocks PostHog loses nothing: the send fails quietly.
- A new property needs an update to this record, to the README and to `telemetry.test.ts`, which asserts the exact payload.
