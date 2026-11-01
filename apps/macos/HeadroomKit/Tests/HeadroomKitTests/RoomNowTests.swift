import Foundation
import Testing

@testable import HeadroomKit

private func roomItems() throws -> (AppFeed, [AccountItem], Date) {
  let feed = try fixture("popover")
  let snapshot = SourceSnapshot(
    source: try source(), state: .connected,
    cached: CachedFeed(feed: feed, etag: nil, readAt: Date()))
  return (
    feed, feed.accounts.map { AccountItem(snapshot: snapshot, account: $0) },
    try #require(Formatting.date(milliseconds: feed.generatedAt))
  )
}

@Test func roomNowUsesProviderOrderAndCountsKnownQuotaOnly() throws {
  let (_, items, now) = try roomItems()
  let room = RoomNow(items: items.reversed(), now: now)
  #expect(
    room.columns.map(\.item.account.provider.rawValue) == [
      "claude", "claude", "codex", "codex", "cursor", "copilot", "antigravity", "grok",
      "vercel_ai_gateway",
    ])
  #expect(room.headline == "6 of 9 accounts have room")
  #expect(room.nextBack?.item.account.id == "codex-personal")
  #expect(room.nextBack?.limit?.resetsAt == 1_793_299_080_000)
}

@Test func roomBindingChoosesFirstBlockerAndExcludesPartPools() throws {
  let (feed, _, now) = try roomItems()
  let side = try #require(feed.accounts.first { $0.id == "claude-side" })
  #expect(RoomNow.binding(side, now: now)?.label == "Weekly")
  #expect(RoomNow.binding(side, now: now)?.percentLeft == 9)
  var cursor = try #require(feed.accounts.first { $0.id == "cursor" })
  cursor.limits[1].percentLeft = 0
  #expect(RoomNow.binding(cursor, now: now)?.label == "Included")
  var personal = try #require(feed.accounts.first { $0.id == "codex-personal" })
  personal.limits[1].percentLeft = 0
  #expect(RoomNow.binding(personal, now: now)?.label == "Weekly")
}

@Test func roomUnknownAndSignInCannotBecomeAvailable() throws {
  let (_, items, now) = try roomItems()
  let room = RoomNow(items: items, now: now)
  let balance = try #require(room.columns.first { $0.item.account.id == "vercel" })
  #expect(balance.state == .unknown)
  #expect(balance.percentLeft == nil)
  #expect(!balance.hasRoom)
  let signIn = try #require(room.columns.first { $0.item.account.id == "grok" })
  #expect(signIn.state == .signIn)
  #expect(!signIn.hasRoom)
  #expect(signIn.text(now: now).contains("Sign-in needed"))
}

@Test func roomKeptReadingsRetainHeightAndCountButNeverAnnounceNextBack() throws {
  let (_, items, now) = try roomItems()
  let offline = items.map { item in
    var snapshot = item.snapshot
    snapshot.state = .offline
    return AccountItem(snapshot: snapshot, account: item.account)
  }
  let room = RoomNow(items: offline, now: now)
  #expect(room.roomCount == 6)
  #expect(room.nextBack == nil)
  let work = try #require(room.columns.first { $0.item.account.id == "codex-work" })
  #expect(work.state == .kept)
  #expect(work.percentLeft == 82)
  #expect(room.columns.first { $0.item.account.id == "vercel" }?.state == .unknown)
  #expect(room.columns.first { $0.item.account.id == "grok" }?.state == .signIn)
}

@Test func roomProjectionStopsAtResetAndDoesNotUsePastPace() throws {
  let (feed, _, now) = try roomItems()
  let side = try #require(feed.accounts.first { $0.id == "claude-side" })
  var limit = try #require(side.limits.first { $0.label == "Weekly" })
  #expect(RoomNow.projection(limit, now: now) != nil)
  limit.runsOutAt = limit.resetsAt
  #expect(RoomNow.projection(limit, now: now) == nil)
  limit.runsOutAt = Int(now.timeIntervalSince1970 * 1000) - 1
  #expect(RoomNow.projection(limit, now: now) == nil)
}

@Test func roomColumnStatesAndTextPreservePartialUnknowns() throws {
  let (_, items, now) = try roomItems()
  let columns = RoomNow(items: items, now: now).columns
  #expect(columns.first { $0.item.account.id == "claude-side" }?.state == .tight)
  #expect(columns.first { $0.item.account.id == "claude-max" }?.state == .room)
  #expect(columns.first { $0.item.account.id == "codex-personal" }?.state == .out)
  let partial = try #require(columns.first { $0.item.account.id == "antigravity" })
  #expect(partial.percentLeft == 65)
  #expect(partial.hasRoom)
  #expect(partial.text(now: now).contains("Other limits unknown"))
}

@Test func roomBindingRejectsUnavailableAndNonFiniteReadings() throws {
  let (feed, _, now) = try roomItems()
  var account = try #require(feed.accounts.first)
  for index in account.limits.indices { account.limits[index].percentLeft = nil }
  #expect(RoomNow.binding(account, now: now) == nil)
  account.limits[0].percentLeft = .nan
  #expect(RoomNow.binding(account, now: now) == nil)
  account.limits[0].percentLeft = 100
  account.limits[0].unlimited = true
  #expect(RoomNow.binding(account, now: now) == nil)
  account.limits[0].unlimited = false
  account.limits[0].notStarted = true
  #expect(RoomNow.binding(account, now: now) == nil)
}
