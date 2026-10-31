import Foundation
import Testing

@testable import HeadroomKit

private func ledger() throws -> (AppFeed, [LedgerRow], Date) {
  let feed = try fixture("popover")
  let snapshot = SourceSnapshot(
    source: try source(), state: .connected,
    cached: CachedFeed(feed: feed, etag: nil, readAt: Date()))
  let now = try #require(Formatting.date(milliseconds: feed.generatedAt))
  let items = feed.accounts.map { AccountItem(snapshot: snapshot, account: $0) }
  let utc = try #require(TimeZone(identifier: "UTC"))
  return (
    feed,
    RoomNow(items: items, now: now).columns.map { LedgerRow(column: $0, now: now, timeZone: utc) },
    now
  )
}

private func row(_ rows: [LedgerRow], _ id: String) throws -> LedgerRow {
  try #require(rows.first { $0.item.account.id == id })
}

@Test func ledgerShowsSessionThenTheBindingLongerWindow() throws {
  let (_, rows, _) = try ledger()
  let max = try row(rows, "claude-max")
  #expect(max.meters.map(\.label) == ["Session", "Weekly"])
  #expect(max.meters.map(\.value) == ["93%", "62%"])
  let cursor = try row(rows, "cursor")
  #expect(cursor.meters.map(\.label) == ["Included, billing cycle"])
  let work = try row(rows, "codex-work")
  #expect(work.meters.map(\.label) == ["Weekly"])
}

@Test func ledgerMarksOutAndProjectedRunOutOnTheRightEdge() throws {
  let (_, rows, _) = try ledger()
  let personal = try row(rows, "codex-personal")
  #expect(personal.meters[0].tone == .out)
  #expect(personal.meters[0].note.hasPrefix("back "))
  #expect(personal.meters[0].alarm)
  let side = try row(rows, "claude-side")
  #expect(side.meters[1].tone == .tight)
  #expect(side.meters[1].runsOut)
  #expect(side.meters[1].note.hasPrefix("out "))
  #expect(side.meters[0].note.hasPrefix("in "))
}

@Test func ledgerPicksOneExtraInPriorityOrder() throws {
  let (_, rows, _) = try ledger()
  #expect(try row(rows, "codex-work").extra?.value == "2")
  #expect(try row(rows, "codex-work").extra?.label.hasPrefix("banked") == true)
  #expect(try row(rows, "claude-max").extra?.value == "1")
  #expect(try row(rows, "cursor").extra == LedgerRow.Extra(value: "$12.40", label: "of $50"))
  #expect(
    try row(rows, "codex-personal").extra == LedgerRow.Extra(value: "363.95", label: "credits"))
  #expect(try row(rows, "claude-side").extra == nil)
}

@Test func ledgerShowsABalanceAgainstWhatWasBoughtWhenThereIsNoQuota() throws {
  let (_, rows, _) = try ledger()
  let vercel = try row(rows, "vercel")
  #expect(vercel.meters.count == 1)
  #expect(vercel.meters[0].value == "$18.42")
  #expect(vercel.meters[0].note == "of $50 bought")
  #expect(abs((vercel.meters[0].fill ?? 0) - 36.84) < 0.01)
  #expect(vercel.extra == nil)
}

@Test func ledgerBalanceWithoutUsageHasNoMeter() throws {
  var (feed, _, now) = try ledger()
  var vercel = try #require(feed.accounts.first { $0.id == "vercel" })
  vercel.charges.removeAll { $0.key.hasSuffix("total_used") }
  feed.accounts = [vercel]
  let snapshot = SourceSnapshot(
    source: try source(), state: .connected, cached: CachedFeed(feed: feed, etag: nil, readAt: now))
  let column = RoomColumn(item: AccountItem(snapshot: snapshot, account: vercel), now: now)
  let meter = try #require(LedgerRow(column: column, now: now).meters.first)
  #expect(meter.fill == nil)
  #expect(meter.tone == .unknown)
  #expect(meter.note.isEmpty)
}

@Test func ledgerSummaryCountsOutAndLowOncePerAccount() throws {
  let (feed, rows, _) = try ledger()
  let summary = LedgerSummary(rows: rows, feeds: [feed])
  #expect(summary.out == 1)
  #expect(summary.low == 1)
  #expect(summary.banked == 3)
  #expect(summary.plans == nil)
  #expect(summary.extraSpend == nil)
}

@Test func countdownAndAmountFormats() {
  let now = Date(timeIntervalSince1970: 0)
  #expect(Formatting.countdown(to: now.addingTimeInterval(7800), now: now) == "in 2h 10m")
  #expect(
    Formatting.countdown(to: now.addingTimeInterval(6 * 86400 + 61200), now: now) == "in 6d 17h")
  #expect(Formatting.countdown(to: now.addingTimeInterval(2700), now: now) == "in 45m")
  #expect(Formatting.countdown(to: now, now: now) == "now")
  #expect(Formatting.amount(3.2, unit: "USD") == "$3.20")
  #expect(Formatting.amount(20, unit: "USD") == "$20")
  #expect(Formatting.amount(579.74, unit: "credits") == "579.74")
}

@Test func demoFeedMovesEveryInstantByTheSameAmount() throws {
  let url = try #require(
    Bundle.module.url(forResource: "demo", withExtension: "json", subdirectory: "Fixtures"))
  let data = try Data(contentsOf: url)
  let original = try JSONDecoder().decode(AppFeed.self, from: data)
  let now = Date(timeIntervalSince1970: 1_900_000_000)
  let demo = try DemoFeed.current(data, now: now)
  let shift = 1_900_000_000_000 - original.generatedAt
  #expect(demo.generatedAt == 1_900_000_000_000)
  #expect(demo.accounts.count == original.accounts.count)
  for (moved, source) in zip(demo.accounts, original.accounts) {
    for (a, b) in zip(moved.limits, source.limits) {
      #expect(a.resetsAt == b.resetsAt.map { $0 + shift })
      #expect(a.percentLeft == b.percentLeft)
    }
  }
  #expect(demo.notices.first?.occurredAt == original.notices.first.map { $0.occurredAt + shift })
}

@Test func displayPreferencesLoadFilesSavedBeforeNewFields() throws {
  let old = Data(#"{"itemStyle":"percentage","hiddenAccounts":[],"accountOrder":[]}"#.utf8)
  let value = try JSONDecoder().decode(DisplayPreferences.self, from: old)
  #expect(value.itemStyle == .logoAndRoom)
  #expect(value.slots == [.init()])
  #expect(value.providerLogos && value.colorLowOut)
  #expect(value.checkSeconds == 120)
  let unknown = Data(#"{"checkSeconds":7}"#.utf8)
  #expect(try JSONDecoder().decode(DisplayPreferences.self, from: unknown).checkSeconds == 120)
  #expect(value.appearance == .system)
  #expect(!value.privacy)
  #expect(!value.demo)
  #expect(value.sourceFilter == nil)
}

@Test func pinnedMenuStyleBecomesOneAccountSlot() throws {
  let old = Data(#"{"itemStyle":"pinned","followedAccount":"source-a/account-a"}"#.utf8)
  let value = try JSONDecoder().decode(DisplayPreferences.self, from: old)
  #expect(value.itemStyle == .accounts)
  #expect(value.slots == [.init(account: "source-a/account-a")])
  let badge = Data(#"{"itemStyle":"logoAndBadge"}"#.utf8)
  #expect(try JSONDecoder().decode(DisplayPreferences.self, from: badge).itemStyle == .logo)
}

@Test func noticesGroupByCalendarDayAndShowElapsedTime() throws {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
  let now = Date(timeIntervalSince1970: 86400 * 10 + 3600 * 2)
  #expect(NoticeDay(now.addingTimeInterval(-3600), now: now, calendar: calendar) == .today)
  #expect(NoticeDay(now.addingTimeInterval(-3 * 3600), now: now, calendar: calendar) == .yesterday)
  #expect(NoticeDay(now.addingTimeInterval(-2 * 86400), now: now, calendar: calendar) == .earlier)
  #expect(Formatting.elapsed(now.addingTimeInterval(-90), now: now) == "2 min")
  #expect(Formatting.elapsed(now.addingTimeInterval(-9 * 3600), now: now) == "9 h")
  #expect(Formatting.elapsed(now.addingTimeInterval(-5 * 86400), now: now) == "5 d")
}

@Test func pollsDifferingOnlyInReadTimeShowTheSameReadings() throws {
  let feed = try fixture("popover")
  let source = try source()
  let first = [
    SourceSnapshot(
      source: source, state: .connected,
      cached: CachedFeed(feed: feed, etag: nil, readAt: Date(timeIntervalSince1970: 0)))
  ]
  let later = [
    SourceSnapshot(
      source: source, state: .connected,
      cached: CachedFeed(feed: feed, etag: nil, readAt: Date(timeIntervalSince1970: 60)))
  ]
  #expect(SourceSnapshot.sameReadings(first, later))
  var changed = feed
  changed.accounts[0].name = "Renamed"
  let renamed = [
    SourceSnapshot(
      source: source, state: .connected,
      cached: CachedFeed(feed: changed, etag: nil, readAt: Date()))
  ]
  #expect(!SourceSnapshot.sameReadings(first, renamed))
  let offline = [SourceSnapshot(source: source, state: .offline, cached: first[0].cached)]
  #expect(!SourceSnapshot.sameReadings(first, offline))
}
