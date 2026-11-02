---
name: app-api-compatibility
description: Keep every supported Headroom for Mac release working with every supported server. Use before changing the Mac app API (`packages/view-model/src/app-feed.ts`, `apps/server/src/routes/app.ts`, `scripts/app-contract.ts`), Mac code that reads a server, the minimum server version, or the oldest supported Mac release.
---

# App API compatibility

A server and a Mac app ship separately, so any pairing of a supported server and a supported Mac release must work. The rules hold in two directions:

- **Old Macs, new server.** Each `macos-vX.Y.Z` tag holds the contract that release decodes with. `mise run mac:compat` checks today's server against every tagged release from `oldestSupportedMac` in `apps/macos/Contract/compatibility.json` onward.
- **New Mac, old server.** `ServerCompatibility.minimumServer` in HeadroomKit names the oldest server this build reads. `Tests/HeadroomKitTests/Fixtures/Servers/<minimum>.json` is that server's feed, frozen.

The app never refuses a server by its version number. A server built from `main` reports the last release while it already has newer endpoints. The app decides from what the server answers and uses versions only in messages: a missing endpoint or a missing field asks for a server update, and a value or type it does not know asks for an app update. The decision record is D47.

## Server change: keep `/api/app/v1` additive

1. Add fields and endpoints. Keep every field a released Mac requires, at its type and as always sent. Keep every request a released Mac makes accepted.
2. For a field whose values grow with the server, such as providers, list it in `openEnumFields` in `scripts/app-contract.ts`. Then the app decodes it as a plain string and shows an unknown value plainly. Values added to a closed enum break each Mac release that knows the old list. The check flags them.
3. For a change that cannot be additive, add `/api/app/v2` beside v1. Keep v1 until `oldestSupportedMac` passes every release that reads it.
4. Run `mise run mac:contract` and commit `apps/macos/Contract/openapi.json`.

## Mac change: read what the minimum server sends

1. Read a new field as optional, and leave the feature out when it is absent. Treat a 404 from a new endpoint the same way. The rest of the source keeps reading.
2. When a feature cannot work without the new field or endpoint, raise `ServerCompatibility.minimumServer` to the first server release that has it. That server release ships first. Replace the frozen feed in `Fixtures/Servers/` with one from that release. A feed regenerated from today's server would hide a broken older one.
3. Say "Needs server X.Y.Z or later" in the Mac release notes when the minimum rises.

## Dropping old Macs

Raise `oldestSupportedMac` in `apps/macos/Contract/compatibility.json` only when the owner agrees to stop supporting those releases.

## Done when

- `mise run check` passes. It includes `mac:contract:check` and `mac:compat`.
- `mise run mac:test` passes, including the frozen feed test.
- The minimum server and the oldest supported Mac match in three places: `ServerCompatibility`, `compatibility.json`, and the tables in [the Mac app architecture](../../../docs/architecture/mac-app.md#server-compatibility) and [the install guide](../../../docs/operations/install.md#compatibility).
