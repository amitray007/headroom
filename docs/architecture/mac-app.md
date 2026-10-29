# Headroom for Mac

**Status: planned, not implemented.** Decision: [ADR 0004](../decisions/0004-mac-app.md). The approved design is round 5 of the Mac mockups, kept in the private `headroom-visuals` repository.

Headroom for Mac is a menu bar app with desktop widgets and notifications. It reads one or more Headroom servers and never changes an account. This document covers its parts, the server routes it needs, how data moves, the setup and the build order.

## Parts

```
 Headroom server (one per source)                Mac
 ┌──────────────────────────────┐               ┌───────────────────────────────────────┐
 │ scheduler → snapshots        │               │ Headroom.app (menu bar, not sandboxed)│
 │ view-model → feed + notices  │  HTTPS / LAN  │  Poller ─ one per source              │
 │ GET /api/app/v1/feed  ◄──────┼── Bearer ─────┤  Keychain: one item, every token      │
 │ API tokens (read scope)      │   token       │  Feed cache, notice store             │
 └──────────────────────────────┘               │  Popover · Settings · Banners         │
                                                │        │ writes widget cache          │
                                                │        ▼                              │
                                                │ Widget extension (sandboxed)          │
                                                │  reads cache only, no network         │
                                                └───────────────────────────────────────┘
```

| Part | Owns |
| --- | --- |
| `apps/macos/Headroom` | The app target: `MenuBarExtra` popover, Settings window, notification banners |
| `apps/macos/Widgets` | The widget extension: timelines and App Intent configuration, from the cache only |
| `apps/macos/HeadroomKit` | Local Swift package: generated feed types, client, source store, Keychain, poller, feed cache, notice store, formatting |
| `apps/macos/Contract/openapi.json` | Generated from Zod; never edited by hand |
| `packages/view-model/src/app-feed.ts` | Feed schema (Zod) and the builder that turns the overview into the feed |
| `apps/server` | Token verification, `/api/app/v1/*` routes, token management routes |
| `apps/web` | Settings, Devices: create, list and revoke tokens |

## Server changes

### API tokens

- The Better Auth API key plugin, pinned to the `better-auth` version, with sessions for API keys off. `bun run auth:generate` adds its table to `packages/core/src/db/auth-schema.ts`; the data model documents it.
- One permission, `{ app: ["read"] }`. The scope name `read` goes into `packages/core/src/enums.ts` and the data model together.
- A token is sent as `Authorization: Bearer <token>`. The middleware on `/api/app/v1/*` accepts only a token with the `read` permission and only `GET`. No other route reads the header, so a token never reaches a session route.
- Management routes need a session and pass the cross-site guard:

| Route | Purpose |
| --- | --- |
| `GET /api/tokens` | Name, prefix, created, last used, expiry. Never the token |
| `POST /api/tokens` | `{ name }`. Returns the token once |
| `DELETE /api/tokens/:id` | Revoke |

Tests prove that a token gets 401 on every session route and every mutating route, that a revoked or expired token gets 401, and that failed attempts are rate limited.

### Feed

`GET /api/app/v1/feed?tz=<minutes>` returns, for one source:

| Field | Content |
| --- | --- |
| `apiVersion` | `1`. A breaking change adds `/api/app/v2/` |
| `serverVersion`, `generatedAt` | For the Settings source list and the age line |
| `refreshIntervalMs`, `staleAfterMs` | The server's collection cadence; the app derives stale from `lastSuccessAt` |
| `dashboardUrl` | `HEADROOM_PUBLIC_URL` when set, else null. The app then uses the source URL |
| `providerOrder`, `accounts` | Accounts in the owner's order. Each: id, provider, name, plan, identity, state, reconnect reason, `lastSuccessAt`, `observedAt`, limits (percent left, reset time, run-out time when a pace exists), charges in their own units with caps, banked resets (count, expiries) |
| `summary` | Plan prices from the Wallet as a monthly total in the display currency, or null when no cost is entered |
| `notices` | `notificationEventSchema` events, derived with the app's `tz` and the exact time style |

Rules carried from the dashboard: unknown is null, never 0; units stay separate; no provider account id or workspace id; no credential, raw response or run error text. The route sets an `ETag` from the body hash and answers `If-None-Match` with 304.

## Data flow on the Mac

### Sources

A source is `{ id, name, baseURL }` in the app's settings, plus its token, kept with the other tokens in one Keychain item keyed by source id. "This Mac" is a source with `http://127.0.0.1:8080`. The app probes `/healthz` there at first launch and offers it when a server answers.

| Source state | When | Shown |
| --- | --- | --- |
| Connected | Last read succeeded | Accounts; age in the footer |
| Offline | Network error or timeout | Last feed with its age; source marked offline in the footer |
| Signed out | 401 | Last feed dimmed; "Token revoked" with a link to the dashboard's Devices page |
| Needs update | 404 on `/api/app/v1/feed` | "Update this server to use the Mac app" |
| No data yet | Added, never read | Skeleton rows |

### Polling and cache

- Every 2 minutes in the background, every 30 seconds while the popover is open, at once on open when the last read is older than 30 seconds, on wake and on network change. Sources are read in parallel with a 15-second timeout.
- Each 200 response is written to `feed-<source id>.json` in the app's Application Support folder, with its ETag. The app starts from these files.
- After each change the app writes one merged widget cache (accounts of every source, already formatted for widget sizes) and calls `WidgetCenter.reloadAllTimelines()`. Widget timelines add entries at the next reset or run-out so the widget changes on time without the app.

### Notices

- The notice store keeps, per notice id: first seen, read, bannered. Ids missing from two feeds in a row are dropped.
- A new id that is unread, of a kind the owner left on, from a source that has been read before, gets one banner. Clicking it opens the popover on that notice; its link opens the account on the source's dashboard.
- Mark read, mark unread and mark all read act on the store only. The menu bar icon shows a dot while unread notices exist.

## Security

- Tokens stay in the Keychain, never in files, logs or the widget cache. The widget cache holds the account names, figures and times the widget shows, nothing else.
- `http:` is allowed only for loopback and private LAN addresses; any other address needs `https:`.
- The app makes no request to any host except the configured sources.
- The app never calls a mutating route. The client has no `POST`, `PUT`, `PATCH` or `DELETE` method.

## Development setup

| Need | Choice |
| --- | --- |
| Xcode | The version `macos.yml` pins (26.x until GitHub's macos-26 image defaults to 27) |
| Commands | `mise run mac:contract` regenerates the OpenAPI document; `mise run mac:test` runs `swift test` in `HeadroomKit`; `mise run mac:build` runs `xcodebuild` for the app |
| Gate | `mise run check` gains the contract freshness check; it does not build Swift, so Linux CI is unchanged |
| Local data | `mise run dev` plus a token from the dev dashboard. Debug builds also accept a synthetic feed made from the Demo Mode data, for tests and screenshots |
| Fixtures | Synthetic only, generated from `@headroom/view-model/demo` |

## Release

| Step | Detail |
| --- | --- |
| Version | release-please package `apps/macos`, component `macos`, `release-type: simple`, `version.txt`; tags `macos-vX.Y.Z`; separate release pull requests; root package `exclude-paths: ["apps/macos"]` |
| Build | `macos-26` arm64 runner, pinned Xcode, universal binary, `MARKETING_VERSION` from `version.txt` |
| Sign | Ad-hoc (`codesign -s -`); ADR 0004 records why a self-signed certificate does not help |
| Package | `Headroom-<version>.zip` (`ditto -c -k --keepParent`) and `SHA256SUMS` on the `macos-v*` release |
| Latest guard | The job marks the Mac release not latest and the last `v*` release latest, so `releases/latest` keeps serving the server |
| Cask | `scripts/render-cask.ts` writes `Casks/headroom-mac.rb` (url, sha256, `depends_on macos: ">= :sequoia"`, `postflight` xattr, `zap`), committed to `main` like the formula |
| Smoke | Install the rendered cask on the runner, check the signature and quarantine attribute, start the app, confirm the process runs |
| Rollback | Delete the release assets and revert the cask commit; the previous cask version stays installable from Git history |

Existing workflows read the root package's outputs (`release_created`, `version`). The change checks they still refer to the root package once a second package exists.

## Build order

Each phase is one pull request or a short stack. Phase 1 ships in a server release before the app needs it.

| Phase | Work | Done when |
| --- | --- | --- |
| 0. Spikes | Signing identity and Keychain across an update; widget cache path; banners on a cask install; 420 pt `MenuBarExtra` popover | Each spike answered in ADR 0004 |
| 1. Server | API tokens, Devices settings, feed route and schema, contract script and check | Token tests pass; feed matches the overview for the demo data |
| 2. App core | `HeadroomKit`, sources and Keychain, poller and cache, popover per round 5, Settings | The app shows two sources and every source state |
| 3. Widgets and notices | Widget extension and configuration, notice store, banners, notices list | All 17 kinds drawn and bannered once; widgets update at resets |
| 4. Release | release-please package, `macos.yml`, cask, latest guard, install docs | A test tag installs through the cask on a clean runner |

Out of scope for the first release: starting or installing the local server from the app, a `headroom token create` command for one-step pairing with This Mac, and an in-app updater.
