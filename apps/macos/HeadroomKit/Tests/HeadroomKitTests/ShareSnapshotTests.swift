import Foundation
import Testing

@testable import HeadroomKit

private let utc = TimeZone(identifier: "UTC")!

private func rows(identity: String? = nil) throws -> ([LedgerRow], Date) {
  var feed = try fixture("popover")
  if let identity {
    for index in feed.accounts.indices { feed.accounts[index].identity = identity }
  }
  let snapshot = SourceSnapshot(
    source: try source(), state: .connected,
    cached: CachedFeed(feed: feed, etag: nil, readAt: Date()))
  let now = try #require(Formatting.date(milliseconds: feed.generatedAt))
  let items = feed.accounts.map { AccountItem(snapshot: snapshot, account: $0) }
  return (
    RoomNow(items: items, now: now).columns.map { LedgerRow(column: $0, now: now, timeZone: utc) },
    now
  )
}

private func ids(_ rows: [LedgerRow], _ accounts: String...) -> Set<String> {
  Set(rows.filter { accounts.contains($0.item.account.id) }.map(\.id))
}

private func snapshot(
  _ rows: [LedgerRow], _ selected: Set<String>, now: Date,
  _ change: (inout ShareOptions) -> Void = { _ in }
) -> ShareSnapshot {
  var options = ShareOptions()
  change(&options)
  return ShareSnapshot(rows: rows, selected: selected, options: options, now: now, timeZone: utc)
}

@Test func shareKeepsThePopoverOrderAndOnlyThePickedAccounts() throws {
  let (rows, now) = try rows()
  let share = snapshot(rows, ids(rows, "codex-work", "claude-side", "cursor"), now: now)
  let order = rows.map(\.id).filter {
    ids(rows, "codex-work", "claude-side", "cursor").contains($0)
  }
  #expect(share.entries.map(\.id) == order)
}

@Test func shareTitlesFollowTheScope() throws {
  let (rows, now) = try rows()
  if case .all(let providers) = snapshot(rows, Set(rows.map(\.id)), now: now).title {
    #expect(providers.count == Set(rows.map { $0.item.account.provider.rawValue }).count)
  } else {
    Issue.record("Every account should title the picture All accounts")
  }
  #expect(
    snapshot(rows, ids(rows, "codex-work", "codex-personal"), now: now).title == .provider("codex"))
  let one = snapshot(rows, ids(rows, "cursor"), now: now)
  #expect(one.title == .account(one.entries[0]))
  guard
    case .some(let count, let providers) = snapshot(rows, ids(rows, "cursor", "grok"), now: now)
      .title
  else {
    Issue.record("Two providers should title the picture by count")
    return
  }
  #expect(count == 2)
  #expect(Set(providers) == ["cursor", "grok"])
}

@Test func shareHidesEmailsByDefaultAndShowsThemOnRequest() throws {
  let (rows, now) = try rows(identity: "ines@example.com")
  let picked = ids(rows, "claude-max")
  #expect(snapshot(rows, picked, now: now).entries[0].detail == "Max 5x")
  #expect(
    snapshot(rows, picked, now: now) { $0.hideEmails = false }.entries[0].detail
      == "Max 5x · ines@example.com")
}

@Test func hiddenNamesNumberAccountsWithinTheirProvider() throws {
  let (rows, now) = try rows()
  let all = snapshot(rows, Set(rows.map(\.id)), now: now) { $0.hideNames = true }
  let codex = all.entries.filter { $0.provider == "codex" }.map(\.name)
  #expect(codex.sorted() == ["Account 1", "Account 2"])
  #expect(all.entries.allSatisfy { $0.name.hasPrefix("Account ") })
  // The number belongs to the account, not to its place among the picked ones.
  let second = try #require(rows.filter { $0.item.account.provider == .codex }.last)
  let alone = snapshot(rows, [second.id], now: now) { $0.hideNames = true }
  #expect(alone.entries[0].name == "Account 2")
}

@Test func shortNamesSayTheAccountOnlyWhenTheProviderRepeats() throws {
  let (rows, now) = try rows()
  let share = snapshot(rows, ids(rows, "codex-work", "codex-personal", "cursor"), now: now)
  #expect(share.entries.first { $0.provider == "cursor" }?.shortName == "Cursor")
  #expect(
    Set(share.entries.filter { $0.provider == "codex" }.map(\.shortName)) == ["Work", "Personal"])
}

@Test func hidingMoneyDropsChargesAndTurnsABalanceIntoAPercent() throws {
  let (rows, now) = try rows()
  let picked = ids(rows, "cursor", "codex-personal", "codex-work", "vercel")
  let shown = snapshot(rows, picked, now: now)
  #expect(shown.entries.first { $0.id.hasSuffix("/cursor") }?.extra?.value == "$12.40")
  let hidden = snapshot(rows, picked, now: now) { $0.hideMoney = true }
  #expect(hidden.entries.first { $0.id.hasSuffix("/cursor") }?.extra == nil)
  #expect(hidden.entries.first { $0.id.hasSuffix("/codex-personal") }?.extra == nil)
  // Banked resets are not money.
  #expect(hidden.entries.first { $0.id.hasSuffix("/codex-work") }?.extra?.value == "2")
  let vercel = try #require(hidden.entries.first { $0.id.hasSuffix("/vercel") }?.meters.first)
  #expect(vercel.value == "37%")
  #expect(vercel.note == "of what was bought")
  #expect(!vercel.value.contains("$"))
}

@Test func tightestMeterPutsOutFirstThenLow() throws {
  let (rows, now) = try rows()
  let share = snapshot(rows, ids(rows, "codex-personal", "claude-side", "claude-max"), now: now)
  #expect(share.entries.first { $0.id.hasSuffix("/codex-personal") }?.tone == .out)
  let side = try #require(share.entries.first { $0.id.hasSuffix("/claude-side") })
  #expect(side.tone == .tight)
  #expect(side.tightest?.label == "Weekly")
  let max = try #require(share.entries.first { $0.id.hasSuffix("/claude-max") })
  #expect(max.tightest?.value == "62%")
  #expect(share.out == 1)
  #expect(share.low == 1)
  #expect(share.tally == "3 accounts · 1 out · 1 low")
}

@Test func tightestReadsRoomFromTheUsedView() {
  let low = LedgerRow.Meter(
    fill: 80, value: "80%", label: "Session", tone: .room, note: "", alarm: false, runsOut: false)
  let high = LedgerRow.Meter(
    fill: 30, value: "30%", label: "Weekly", tone: .room, note: "", alarm: false, runsOut: false)
  // Used 80% leaves 20% room, which is tighter than used 30%.
  #expect(ShareSnapshot.tightest([low, high], view: .used)?.label == "Session")
  #expect(ShareSnapshot.tightest([low, high], view: .left)?.label == "Weekly")
}

@Test func spotlightFallsBackToLedgerPastThreeAccounts() throws {
  let (rows, now) = try rows()
  let three = ids(rows, "cursor", "grok", "copilot")
  #expect(snapshot(rows, three, now: now) { $0.style = .spotlight }.style == .spotlight)
  let four = three.union(ids(rows, "vercel"))
  #expect(snapshot(rows, four, now: now) { $0.style = .spotlight }.style == .ledger)
}

@Test func stampShowsTheTimeUnlessTurnedOff() throws {
  let (rows, now) = try rows()
  let stamp = try #require(snapshot(rows, ids(rows, "cursor"), now: now).stamp)
  #expect(stamp.contains(Formatting.clock(now, timeZone: utc)))
  #expect(snapshot(rows, ids(rows, "cursor"), now: now) { $0.showTime = false }.stamp == nil)
}

@Test func oneAccountTallyNamesOnlyTrouble() throws {
  let (rows, now) = try rows()
  #expect(snapshot(rows, ids(rows, "grok"), now: now).tally == "")
  #expect(snapshot(rows, ids(rows, "codex-personal"), now: now).tally == "1 out")
}

@Test func privacyModeHidesNamesAndMoneyInAShare() {
  let options = ShareOptions().applying(privacy: true)
  #expect(options.hideNames && options.hideEmails && options.hideMoney)
  #expect(ShareOptions().applying(privacy: false) == ShareOptions())
}

@Test func shareOptionsLoadFromOlderAndPartialFiles() throws {
  let decoder = JSONDecoder()
  let partial = try decoder.decode(ShareOptions.self, from: Data(#"{"style":"room"}"#.utf8))
  #expect(partial.style == .room)
  #expect(partial.hideEmails)
  let unknown = try decoder.decode(ShareOptions.self, from: Data(#"{"style":"poster"}"#.utf8))
  #expect(unknown.style == .ledger)
  let preferences = try decoder.decode(DisplayPreferences.self, from: Data("{}".utf8))
  #expect(preferences.share == ShareOptions())
  var saved = DisplayPreferences()
  saved.share.backdrop = .ink
  let round = try decoder.decode(DisplayPreferences.self, from: JSONEncoder().encode(saved))
  #expect(round.share.backdrop == .ink)
}

@Test func fixedSizesHaveACanvasAndFitDoesNot() {
  #expect(ShareOptions.Size.fit.canvas == nil)
  #expect(ShareOptions.Size.square.canvas == CGSize(width: 720, height: 720))
  #expect(ShareOptions.Size.wide.canvas == CGSize(width: 960, height: 540))
}
