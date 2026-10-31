import Foundation
import Testing

@testable import HeadroomKit

private func limit(reset: Date?, runOut: Date?, left: Double? = 12) -> WidgetLimitRow {
  WidgetLimitRow(
    key: "weekly", percentLeft: left, unlimited: false, part: false, interface: "private",
    resetsAt: reset, runsOutAt: runOut, label: "Weekly", left: "12% left", reset: "Friday",
    runOut: nil)
}

@Test func timelineContainsEveryFutureResetRunOutAndStaleBoundaryOnce() {
  let now = Date(timeIntervalSince1970: 10_000)
  let runOut = now.addingTimeInterval(60)
  let reset = now.addingTimeInterval(120)
  let stale = now.addingTimeInterval(180)
  let row = WidgetAccountRow(
    id: "synthetic", sourceName: "Home", name: "Side", provider: "claude",
    state: .connected, status: "room", age: "1 min ago", observedAt: now, staleAt: stale,
    signIn: false,
    bindingKey: "weekly", balance: nil, balanceLabel: nil, balanceInterface: nil, bankedCount: nil,
    limits: [
      limit(reset: reset, runOut: runOut), limit(reset: reset, runOut: now.addingTimeInterval(-60)),
      limit(reset: nil, runOut: nil),
    ], charges: [], banked: nil)
  let cache = WidgetCache(writtenAt: now, rows: [row], sources: [])
  #expect(WidgetTimeline.dates(cache: cache, now: now) == [now, runOut, reset, stale])
  #expect(WidgetTimeline.dates(cache: cache, now: reset) == [reset, stale])
  #expect(WidgetTimeline.dates(cache: nil, now: now) == [now])
}

@Test func timelineTransitionsAtTheEventWithoutInventingAResetReading() {
  let now = Date(timeIntervalSince1970: 10_000)
  let runOut = now.addingTimeInterval(60)
  let reset = now.addingTimeInterval(120)
  let value = limit(reset: reset, runOut: runOut)
  #expect(WidgetTimeline.next(value, at: now).hasPrefix("Runs out "))
  #expect(WidgetTimeline.next(value, at: runOut) == "May be out if pace holds")
  #expect(WidgetTimeline.percent(value, at: runOut) == 12)
  #expect(WidgetTimeline.next(value, at: reset) == "Reset passed · read needed")
  #expect(WidgetTimeline.percent(value, at: reset) == nil)
  #expect(WidgetTimeline.next(limit(reset: reset, runOut: nil, left: nil), at: now) == "Unknown")
  #expect(
    WidgetTimeline.next(limit(reset: reset, runOut: nil, left: 0), at: now).hasPrefix("Back "))
}

@Test func cacheEntitiesKeepSourceIdentitySelectionOrderAndAccountScopedLimits() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let location = WidgetCacheLocation(url: directory.appending(path: "widget-cache.json"))
  let accountQuery = WidgetAccountQuery(location: location)
  let limitQuery = WidgetLimitQuery(location: location)
  #expect(try await accountQuery.suggestedEntities().isEmpty)
  let feed = try fixture()
  let a = try source()
  let b = try source()
  let now = try #require(Formatting.date(milliseconds: feed.generatedAt))
  try WidgetCacheWriter(location: location).write(
    sources: [a, b].map {
      SourceSnapshot(
        source: $0, state: .connected, cached: CachedFeed(feed: feed, etag: nil, readAt: now))
    }, now: now)
  let accounts = try await accountQuery.suggestedEntities()
  #expect(accounts.count == feed.accounts.count * 2)
  #expect(Set(accounts.map(\.id)).count == accounts.count)
  #expect(accounts.allSatisfy { $0.title.contains(" · Synthetic source") })
  let picked = try #require(accounts.first)
  let last = try #require(accounts.last)
  #expect(
    try await accountQuery.entities(for: [last.id, "removed", picked.id]).map(\.id) == [
      last.id, picked.id,
    ])
  let cache = try WidgetCacheReader(location: location).read()
  let limits = WidgetLimitEntity.entities(in: cache, accountID: picked.id)
  #expect(limits.count == feed.accounts.first?.limits.count)
  #expect(limits.allSatisfy { $0.accountID == picked.id && !$0.title.contains(" · ") })
  #expect(
    Set(try await limitQuery.suggestedEntities().map(\.id)).count == feed.accounts.flatMap(\.limits)
      .count * 2)
  let firstLimit = try #require(limits.first)
  #expect(
    try await limitQuery.entities(for: ["removed", firstLimit.id]).map(\.id) == [firstLimit.id])
}
