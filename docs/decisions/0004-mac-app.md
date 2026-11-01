# ADR 0004: Headroom for Mac

Status: accepted on 2026-10-30 by the owner, before any code. Items marked "Spike" are confirmed by the first build and may change this record. The design is in [Headroom for Mac](../architecture/mac-app.md).

## Context

The owner wants a native Mac app that shows the same accounts as the dashboard without a browser tab. The design rounds (October 2026) fixed its scope:

- A menu bar app with a popover, desktop widgets and notifications. No main window. A Settings window.
- Read-only. The app never signs in to a provider, reconnects an account or uses a banked reset. Recovery is a link to the dashboard of the account's source.
- Several sources at once: any number of Headroom servers, plus "This Mac", a native install listening on `http://127.0.0.1:8080`.
- Every notification kind the dashboard has, as macOS banners and in a notices list with read and unread state.

Today every API route needs a Better Auth session cookie ([API](../architecture/api.md)), so the server has nothing a native client can call. Notification read state lived in the browser (now on the server, [ADR 0005](0005-shared-notice-read-state.md)).

## Decision

### App stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | Swift 6, strict concurrency | WidgetKit has no other first-class language. Tauri and Electron cannot ship a widget extension |
| Menu bar and popover | SwiftUI `MenuBarExtra` with the window style | Native popover sizing, focus and dismissal; no `NSStatusItem` code unless a spike shows a gap |
| Settings | SwiftUI `Settings` scene | The standard Settings window and shortcut |
| Widgets | WidgetKit extension with App Intent configuration | Accounts and limits are picked per widget, as in the design |
| Notifications | `UserNotifications` | Banners and Notification Center |
| Secrets | Keychain, one item that holds the tokens of every source | The owner's choice. Without a Developer ID, macOS asks for the login password once per item after each update (see [Build and release](#build-and-release)); one item keeps that to one prompt |
| Tests | Swift Testing in a local Swift package | Logic runs under `swift test` without the app host |
| Minimum macOS | 15 Sequoia | `MenuBarExtra`, `@Observable` and App Intent widgets all exist there; one release back from macOS 26 keeps most Macs in |
| Font | Geist, bundled (SIL Open Font License) | Headroom content uses Geist; system chrome uses the system font |

No third-party Swift dependency ships in the app apart from the OpenAPI runtime that the type generator needs (below).

### Connection to a source: API tokens

A source is a Headroom server the app reads. The app authenticates with a read-only API token, never a session cookie:

- The owner creates a token in the dashboard (Settings, Devices) and names it. The dashboard shows the token once. The owner pastes it, with the server URL, into the Mac app. The app keeps it in the Keychain.
- The server stores only a hash. A token has the scope `read` and can reach only the app routes under `/api/app/v1/`. The owner can also give it `refresh` when creating it (D44): that token can change Refresh Every and nothing else. A token cannot change other settings, refresh an account, run an action or read credentials.
- The dashboard lists each token with its name, creation time and last use, and revokes it with one press. A revoked token gets 401 and the app shows the source as signed out with a link to the dashboard.
- Tokens use the Better Auth API key plugin at the same pinned version as `better-auth`, with sessions for API keys off. Its hashing, prefix, expiry and rate limit replace hand-written code. A Hono middleware on `/api/app/v1/*` verifies the token with the `read` permission. Every other route keeps the session check.

### Data: one feed, polled

- The app reads one route per source, `GET /api/app/v1/feed`. It carries every account with its limits, charges and banked resets, the run-out time where a pace exists, the derived notices, and the server's refresh interval. The server shapes it from the same view-model code the dashboard uses, so the Mac app does not reimplement percent, pace or notice rules in Swift.
- The app polls. The server collects every 2 to 30 minutes, so its data changes slowly. The app reads each source every 2 minutes in the background, every 30 seconds while the popover is open, at once on open when the last read is older than 30 seconds, and on wake and on network change. The feed has an `ETag`, so an unchanged feed costs a 304.
- The app keeps the last good feed of each source on disk. It opens with that feed and shows its age. A source that fails keeps its last feed, marked with its age and the failure.
- Server-sent events were rejected: they need a held connection per source and per sleep cycle for data that changes every few minutes.

### Notices: derived on the server, read on the Mac

- The server derives notices with the same rules as the dashboard bell and Telegram delivery, and returns them in the feed. The app passes its time zone (`tz`, as `/api/history` does) so a notice's text uses the Mac's local time and does not go stale.
- Banner history and per-kind switches live on the Mac, keyed by notice id. Read state moved to the server ([ADR 0005](0005-shared-notice-read-state.md)). A notice id changes for the next period, so a repeat arrives unread, as in the dashboard.
- The app posts a banner for a new unread notice that the owner has not switched off. At first launch of a source, existing notices go to the list unread, without banners.

### Repository layout and shared types

- The app lives in `apps/macos/`: an Xcode project with folder-synchronized groups for the app and the widget extension, and a local Swift package, `HeadroomKit`, for the model, the client, the cache and the notice store.
- Zod is the source of truth. The feed schema lives in `packages/view-model`. A script turns it into an OpenAPI 3.1 document with `z.toJSONSchema()` and writes `apps/macos/Contract/openapi.json`. Apple's `swift-openapi-generator` builds the Swift types and client from it at build time. `mise run check` fails when the committed document differs from the schema.

### Build and release

- Signing: no Apple Developer ID and no notarization. The Homebrew cask removes the quarantine attribute after install, so Gatekeeper does not block the app.
- Ad-hoc signing. The spike (2026-10-30) built an app twice and read a Keychain item written by the first build from the second. Both an ad-hoc signature and a self-signed certificate with a stable designated requirement failed with `errSecAuthFailed` when no prompt was allowed, so a self-signed identity buys nothing and needs no CI secret. After an update the app asks for the login password once, for its one Keychain item. A Developer ID would remove the prompt.
- Distribution: a Homebrew cask, `Casks/headroom-mac.rb`, in this repository, which is already its own tap. Its `postflight` runs `xattr -dr com.apple.quarantine` on the app. No Sparkle and no in-app updater: `brew upgrade` updates the app.
- Versions: release-please gets a second package, `apps/macos`, with the component `macos`, its own changelog and `version.txt`, and tags `macos-vX.Y.Z`. The root package excludes `apps/macos`, so a Mac-only commit never bumps the server, and a web or server commit never bumps the Mac app. Each package gets its own release pull request.
- CI: a `macOS` workflow builds and tests the app on GitHub's `macos-26` arm64 runner with a pinned Xcode, on pull requests and pushes that touch `apps/macos/` or the contract. A Mac release builds a universal app, zips it, writes `SHA256SUMS`, attaches both to the `macos-v*` release, renders the cask, installs it on the runner and starts the app as a smoke test.

## Consequences

- The server gains its first non-browser credential. The token scope, the route allowlist and the tests that prove a token cannot reach a session route are the security boundary of this change.
- The API key plugin adds its table through `bun run auth:generate`; the data model and enumerations record the `read` scope.
- The widget extension must run in the App Sandbox or macOS never shows it. Without a Developer ID there is no App Group, so the widget cannot share a container with the app. Spike: the app writes the widget's cache into the widget's own container, or the widget reads the app's cache folder through a read-only sandbox exception. On 2026-10-30 the extension registered and the app wrote both files; the widget's read waits on the owner's manual check. The app uses the widget's own container first and keeps the path behind one type, so the other way is a one-file change.
- Spike: notification permission and banners for an app without a Developer ID are confirmed on a cask install, not only on a debug build. On 2026-10-30 an ad-hoc build asked for permission; a self-signed build sharing its bundle id was refused (`UNErrorDomain` 1). The owner's manual check is pending.
- A Mac release must not become the repository's latest release: the installer, `headroom update` and mise read the server from `releases/latest`. The Mac release job marks its release as not latest.
- The app depends on server routes that ship in a server release first. The feed carries `apiVersion`; an older server answers 404 and the app says the server needs an update.

## Rejected

- Developer ID signing, notarization and Sparkle: the owner chose no paid Apple account for now. This decision can change without touching the app's design.
- Session cookies or a device pairing flow: a pasted token is one copy and one paste, can be revoked from the dashboard, and needs no new sign-in screen in a read-only app.
- Swift ports of the view-model rules: two copies of the percent, pace and notice logic would drift. The server sends results.
- Server-side read state: rejected here, accepted later in [ADR 0005](0005-shared-notice-read-state.md).
- Tauri or Electron: no widget extension, and a second UI stack.
