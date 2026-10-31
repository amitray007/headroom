# Headroom for Mac

**Status: menu bar popover, Settings, HeadroomKit, server token API, feed, configurable widgets and notification banners implemented. Widget installation and notification permission still need owner checks.** Decision: [ADR 0004](../decisions/0004-mac-app.md). The approved popover design is round 6 of the Mac mockups. Settings, widgets and artwork retain round 5. The designs are kept in the private `headroom-visuals` repository.

Headroom for Mac is a menu bar app with desktop widgets and notifications. It reads one or more Headroom servers and never changes an account. This document covers its parts, the server routes it needs, how data moves, the setup and the build order.

## Parts

```
 Headroom server (one per source)                Mac
 ┌──────────────────────────────┐               ┌───────────────────────────────────────┐
 │ scheduler → snapshots        │               │ Headroom.app (menu bar, not sandboxed)│
 │ view-model → feed + notices  │  HTTPS / LAN  │  Poller ─ sources in parallel         │
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
| `apps/macos/Headroom` | App target with a 600 pt SwiftUI popover presented by `NSStatusItem` and `NSPopover`, a summary line, one ledger row per account with disclosures, inline notices, five Settings panes and notification banners |
| `apps/macos/Widgets` | Sandboxed widget extension with App Intent account and limit configuration. Small offers Account or Overall, Medium shows up to three chosen accounts, Large shows eight, and Extra Large adds secondary limits. It reads its own cache only |
| `apps/macos/HeadroomKit` | Swift 6.2 package: `HeadroomAPI` generates public types and a GET client; `HeadroomKit` owns sources, one Keychain token map, polling, feed and notice stores, formatting and widget-cache writing |
| `apps/macos/Shared` | The app and widget views share Geist, provider marks, artwork and surface tokens |
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
| `providerOrder`, `accounts` | Accounts in the owner's order. Each: id, provider, name, plan, identity, state, reconnect reason, `lastSuccessAt`, `observedAt`, limits (percent left, reset time, run-out time when a pace exists), charges in their own units with caps, banked resets (count, unit, expiries) |
| `summary` | `monthlyPlanTotal` from the Wallet in the selected currency (USD when unset), or null when no cost is entered or rates are missing; `extraSpend` totals by unit; `nextLimitBack` for an exhausted limit, or null |
| `notices` | `notificationEventSchema` events, derived with the app's `tz` and the exact time style |

`generatedAt` stays fixed while the cached representation is unchanged. Limits carry `windowKind`, reset wording, Cursor `part` flags and an interface label. Charges carry availability and preserve each metric’s unit. Run-out times use the shared weekly pacing gates at the reading time. The built fields are listed in [App feed](api.md#app-feed).

Rules carried from the dashboard: unknown is null, never 0; units stay separate; no provider account id or workspace id; no credential, raw response or run error text. The route sets an `ETag` from the body hash and answers `If-None-Match` with 304.

## Data flow on the Mac

### Sources

A source is `{ id, name, baseURL }` in the app's settings, plus its token, kept with the other tokens in one Keychain item keyed by source id. "This Mac" is a source with `http://127.0.0.1:8080`. The app probes `/healthz` there at launch and on the Sources pane, and offers it when a server answers. When no server answers, the app looks for an installed one: a launch agent (`club.theblank.headroom` or `homebrew.mxcl.headroom`), the Homebrew formula, or the install script's binary. Start Headroom then runs `launchctl`, `brew services start headroom` or `headroom service install` in a login shell, so the server also starts at every login. Without an install, the pane shows the Homebrew command to copy.

| Source state | When | Shown |
| --- | --- | --- |
| Connected | Last read succeeded | Accounts; the footer's Updated time counts live from this Mac's last read (just now, seconds, then minutes); its tooltip gives the newest account `observedAt`, when the servers last refreshed |
| Offline | Network error or timeout | Last feed with its age; a note above the accounts marks the source offline |
| Signed out | 401 | Last feed dimmed; "Token revoked" with a link to the dashboard's Devices page |
| Needs update | 404 on `/api/app/v1/feed` | "Update this server to use the Mac app" |
| No data yet | Added, never read | Skeleton rows |

### Polling and cache

- Every 2 minutes in the background by default (General, Check every: 30 seconds to 10 minutes), every 30 seconds while the popover is open or sooner when Check every is shorter, at once on open when the last read is older than 30 seconds, on wake and on network change. Sources are read in parallel with a 15-second timeout.
- Each 200 response is written to `feed-<source id>.json` in the app's Application Support folder, with its ETag. The app starts from these files.
- After each change the app writes one merged widget cache (accounts of every source, already formatted for widget sizes) and calls `WidgetCenter.reloadAllTimelines()`. Widget timelines add entries at the next reset or run-out so the widget changes on time without the app.

### Notices

- The notice store keeps, per notice id: first seen, read, bannered. Ids missing from two feeds in a row are dropped.
- Banner history retains id tombstones after visible records expire, so a returning id cannot banner again. A source-token failure has one local sign-out notice; repeated failures keep it in the list without another banner. Provider disconnects also banner at most once per account.
- Authorization is requested only for the first eligible banner. Bad notices use time-sensitive interruption only when the system allows it; otherwise they are active. Warnings are active and information is passive. Banners group by source and account. Each stores its display text so a click can still expand the notice after it leaves the feed. A claim is saved before submission to prevent duplicates after a crash; an OS rejection leaves the notice in the list without retrying its banner.
- A new id that is unread, of a kind the owner left on, from a source that has been read before, gets one banner. Clicking it opens the popover on that notice; its link opens the account on the source's dashboard.
- Mark read, mark unread and mark all read act on the store only. The menu bar icon shows a dot while unread notices exist.

## Security

- Tokens stay in the Keychain, never in files, logs or the widget cache. The widget cache holds the account names, figures and times the widget shows, nothing else.
- `http:` is allowed only for loopback, private LAN and link-local addresses, `.local` names and Tailscale addresses (100.64.0.0/10); any other address needs `https:`.
- The app makes no request to any host except the configured sources.
- The app never calls a mutating route. The client has no `POST`, `PUT`, `PATCH` or `DELETE` method.

## Development setup

| Need | Choice |
| --- | --- |
| Xcode | Swift 6.2 or newer, Swift 6 language mode, macOS 15 deployment target. The skeleton is built locally with Xcode 27 beta; CI will use Xcode 26.x |
| Commands | `mise run mac:contract` regenerates the OpenAPI document; `mise run mac:fixtures` regenerates test feeds; `mise run mac:test` runs Swift Testing in `HeadroomKit`; `mise run mac:build` builds the app and extension into git-ignored `apps/macos/.derived-data` |
| Gate | `mise run check` includes the contract freshness check; it does not build Swift, so Linux CI is unchanged |
| Local data | Sources live in `Application Support/club.theblank.headroom.mac/sources.json`, apart from a native server's `Application Support/Headroom`; tokens live in one Keychain item. Settings verifies a source with `GET /api/app/v1/whoami` before saving. A changed URL requires a new token. Tests use committed synthetic feeds |
| Fixtures | Synthetic only, generated by `scripts/mac-fixtures.ts` from Demo Mode with synthetic account labels and explicit unknown and exhausted limits. Resources live in `HeadroomKit/Tests/HeadroomKitTests/Fixtures` |

The build plugin reads a symlink from `HeadroomAPI/openapi.json` to the committed contract. The export script converts nullable `anyOf` pairs to equivalent OpenAPI 3.1 type unions so the generator retains those fields. Zod remains the source of truth.

The three direct OpenAPI dependencies have exact versions in `Package.swift`. Both package and Xcode lockfiles keep the same resolved graph. The transitive `swift-collections` dependency stays at 1.3.0 for Swift 6.2 compatibility; later releases can require a newer compiler. The command uses `-skipPackagePluginValidation` to run the pinned generator without Xcode's first-build trust dialog; it changes no global Xcode setting. The app is not sandboxed. The widget uses App Sandbox and reads only its cache. Geist is bundled with its SIL OFL license. The round 5 artwork SVGs are unchanged; paired vector PDF assets preserve their light and dark appearances for native rendering.

### Synthetic UI verification

A Debug build with `--synthetic --capture-widgets <directory>` renders the shared widget views with `ImageRenderer` at 2x. The display-only fixture follows the approved widget scenario and contains no identities or source URLs. Captures cover five layouts, nine states, light/dark and colour/dim/tinted. `--synthetic --open-popover` and `--synthetic --open-notice` exercise presentation without posting a notification or requesting permission.

Widget configuration uses WidgetKit's native editor. Account and limit entities come from the cache, limits depend on the chosen account, and Medium declares a maximum of three accounts. WidgetKit owns selection and reorder controls; an extension cannot substitute the mockup's radio, checkbox and move-button layout. Reset and run-out timeline entries update wording from saved dates. A passed reset makes its percentage unknown until a new reading arrives. Stale boundaries also get entries. In accented mode, the dim view is rendered as a full-colour image so system tinting keeps the red forecast and hatching. System placement and rendering still need an owner check. Fonts include static OFL instances of the bundled Geist for consistent widget weights; the Antigravity asset uses a lossless raster conversion because the native SVG renderer omits its mask/filter content.

A Debug build accepts `--synthetic`. It uses the committed round 6 popover fixture, three synthetic sources, an in-memory token vault and temporary stores. No server or production store is used. Add `--capture <directory>` to capture the real SwiftUI views in light and dark appearance, all five Settings panes, inline notices and the source states. The capture run checks read, unread and mark-all-read behavior before exiting. Release builds exclude this mode.

The popover shows one ledger row per account in provider order. The list shows about nine rows, less on a short screen, then scrolls. A longer list stops through the middle of a row under a 24 pt fade, so the cut row marks more below; 12 pt of room after the last row keeps its content clear of the fade at the end, so nothing changes while the list scrolls. The menu bar label is drawn into an image when it changes: a template image when it has one color, otherwise an image for the menu bar's current appearance. A row holds up to two limits: the lowest session window, then the binding longer window. Each limit is ten cells, one per 10% left, with the % and window name on the left and the countdown, return time or projected run-out on the right. A row with no extra lets its limits take the full width; otherwise one extra sits on the right edge, in this order: banked resets, capped spend, credit balance. An account with no quota shows its balance, measured against balance plus total used when the feed reports both. The summary line shows the plan total, extra spend, banked resets and the out and running-low counts. Kept readings and sign-in rows are dimmed. Account disclosures hold every limit, money and banked resets. The Notifications page lists notices like the web notification centre: a status line, Mark all read, All and Unread with counts, and rows grouped by Today, Yesterday and Earlier under pinned headings. Each row has a tone tile, the title, the message, the account with its provider mark, the time and an unread dot. The whole row is a button: a click marks it read through the local notice store and a second click marks it unread. Under the pointer the row fills, gets a border and previews the click with a check or a ring.

Settings keeps the round 5 panes in this order: General, Sources, Menu Bar, List and Notifications. It opens on General. Menu Bar opens with a preview of the item beside stand-ins for the system items, then a Show control with five styles. Logo shows the glyph only. Logo and room adds one account's room. Live logo turns the glyph's three bars into meters, one per account. Live logo can add the figure of the account with least room. Dots shows a 3x3 grid, one row per account, with lit dots for thirds of room left. The item's tooltip names each account with its room. Accounts shows each account as a percent, a ring, or session and longer-window bars, with its provider mark unless Provider logos is off. The styles share one to three slots, ordered by dragging. Each slot holds a chosen account or the tightest account with room that no other slot shows; Logo and room uses the first slot. With Color when low or out on, a low account is yellow and an out or signed-out account is red. The dot after the meters marks unread notifications, or a red problem on an account no slot shows. Settings files saved with the older styles load as Logo and room, Logo, or one Accounts slot for a pinned account. In List, each row shows the provider mark, the provider and account name, then the plan, email and source; Privacy Mode blurs the email until the pointer is over the row. Accounts are ordered by dragging a row onto the one whose place it takes; VoiceOver has Move up and Move down actions. The per-kind switches persist in `NoticeStore` for layer 5; they do not request banner permission. Source edits use a sheet so verification happens before saving. General's Refresh every sets each server's Refresh Every through `PUT /api/app/v1/settings/refresh` (D44). The app asks each source's `whoami` for its token scopes and changes only sources whose token has `refresh`; a read-only source keeps its own setting, and Settings names it and says how to get a token that can change it. Sources shows each server's interval and marks read-only sources. General's Check every sets how often the app reads its sources. General's Show limits as picks room left (the default) or the share used for the popover rows, account details and every menu bar style, like the web's Limits view; colors still follow room left. Widgets keep their own left or used option. General also holds Privacy Mode, which blurs account emails until the pointer is over the row, and Demo Mode, which shows the bundled demo feed with its instants moved to now while real sources keep polling; demo notices never become banners and their read state stays in memory. The popover footer holds the only Open dashboard button, beside a source selector (All or one source) saved with the display preferences. The selector filters accounts and notices. With several sources shown, Open dashboard asks which one. Dashboard links open the source's Detailed dashboard; the web app has no per-account or Devices deep link.

## Release

| Step | Detail |
| --- | --- |
| Version | release-please package `apps/macos`, component `macos`, `release-type: simple`, `version.txt`; tags `macos-vX.Y.Z`; separate release pull requests; root package `exclude-paths: ["apps/macos"]` |
| Build | `macos-26` arm64 runner, Xcode 26.2 (17C52, Swift 6.2.3), universal arm64 + x86_64 binary, `MARKETING_VERSION` from `version.txt`, `CURRENT_PROJECT_VERSION` from the run number |
| Sign | Ad-hoc (`codesign -s -`); ADR 0004 records why a self-signed certificate does not help |
| Package | `Headroom-<version>.zip` (`ditto -c -k --keepParent`) and `SHA256SUMS` uploaded to a draft `macos-v*` release; publish only after both assets download and verify |
| Latest guard | The job marks the Mac release not latest and the last `v*` release latest, so `releases/latest` keeps serving the server |
| Cask | `scripts/render-cask.ts` writes `Casks/headroom-mac.rb` (url, sha256, `depends_on macos: ">= :sequoia"`, `postflight` xattr, `zap`), committed to `main` like the formula |
| Smoke | Install the rendered cask on the runner, check the signature and quarantine attribute, start the app, confirm the process runs, quit; commit the cask only after this passes |
| Rollback | Revert the cask commit and reinstall the previous version; keep published assets and tags unchanged |

Existing workflows read the root package's unprefixed outputs (`release_created`, `version`). Only the Mac workflow reads `apps/macos--release_created` and `apps/macos--version`. The Mac release starts as a draft with `force-tag-creation`, so the release tag exists for checkout without exposing partial assets or becoming latest. Details and retry steps are in [Releases](../operations/releases.md#headroom-for-mac).

## Build order

Each phase is one pull request or a short stack. Phase 1 ships in a server release before the app needs it.

| Phase | Work | Done when |
| --- | --- | --- |
| 0. Spikes | Signing identity and Keychain across an update; widget cache path; banners on a cask install; 420 pt `MenuBarExtra` popover | Each spike answered in ADR 0004 |
| 1. Server | API tokens, Devices settings, feed route and schema, contract script and check | Token tests pass; feed matches the overview for the demo data |
| 2. App core | `HeadroomKit`, sources and Keychain, poller and cache, popover per round 5, Settings | The app shows two sources and every source state |
| 3. Widgets and notices | Widget configuration and banners (the notice store and list already exist) | All 17 kinds bannered once; widgets update at resets |
| 4. Release | release-please package, `macos.yml`, cask, latest guard, install docs | A test tag installs through the cask on a clean runner |

Out of scope for the first release: installing the local server from the app, a `headroom token create` command for one-step pairing with This Mac, and an in-app updater.
