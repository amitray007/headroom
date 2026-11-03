import Foundation
import Testing

@testable import HeadroomKit

private func row(_ id: String, left: Double?, runOut: Date? = nil) -> WidgetAccountRow {
  WidgetAccountRow(
    id: id, sourceName: "Home", name: id, provider: "claude", state: .connected, status: "room",
    age: "now", observedAt: nil, staleAt: nil, signIn: false, bindingKey: "weekly",
    balance: nil, balanceLabel: nil, balanceInterface: nil, bankedCount: nil,
    limits: [
      WidgetLimitRow(
        key: "weekly", percentLeft: left, unlimited: false, part: false, interface: "private",
        resetsAt: nil, runsOutAt: runOut, label: "Weekly", left: "", reset: "", runOut: nil)
    ], charges: [], banked: nil)
}

@Test func widgetPreferencesLoadWithMissingKeysAtTheirDefaults() throws {
  let old = Data(#"{"itemStyle":"dots","privacy":true}"#.utf8)
  let display = try JSONDecoder().decode(DisplayPreferences.self, from: old)
  #expect(display.widgets == WidgetPreferences())
  #expect(display.privacy)

  let partial = Data(#"{"widgets":{"used":true,"accountIDs":["a","b","c","d"]}}"#.utf8)
  let widgets = try JSONDecoder().decode(DisplayPreferences.self, from: partial).widgets
  #expect(widgets.used)
  #expect(widgets.accountID == nil)
  #expect(widgets.limitKey == nil)
  #expect(widgets.accountIDs == ["a", "b", "c"])

  var saved = DisplayPreferences()
  saved.widgets = WidgetPreferences(accountID: "home:side", limitKey: "weekly", used: true)
  let restored = try JSONDecoder().decode(
    DisplayPreferences.self, from: JSONEncoder().encode(saved))
  #expect(restored.widgets == saved.widgets)
}

@Test func widgetCacheCarriesTheSettingsAndReadsOlderCachesWithDefaults() throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let location = WidgetCacheLocation(url: directory.appending(path: "widget-cache.json"))
  let feed = try fixture()
  let now = try #require(Formatting.date(milliseconds: feed.generatedAt))
  let snapshot = SourceSnapshot(
    source: try source(), state: .connected, cached: CachedFeed(feed: feed, etag: nil, readAt: now))
  let account = try #require(feed.accounts.first)
  let settings = WidgetPreferences(
    accountID: AccountItem.widgetID(sourceID: snapshot.id, accountID: account.id),
    limitKey: account.limits.first?.key, used: true)
  try WidgetCacheWriter(location: location).write(
    sources: [snapshot], settings: settings, now: now)
  let cache = try #require(try WidgetCacheReader(location: location).read())
  #expect(cache.settings == settings)
  #expect(cache.rows.contains { $0.id == settings.accountID })

  let older = Data(#"{"writtenAt":0,"rows":[],"sources":[]}"#.utf8)
  let decoded = try JSONDecoder().decode(WidgetCache.self, from: older)
  #expect(decoded.settings == nil)
  #expect(decoded.widgetSettings == WidgetPreferences())
}

@Test func accountsWidgetKeepsChosenAccountsThenFillsWithThoseThatNeedAttention() {
  let now = Date(timeIntervalSince1970: 10_000)
  let rows = [
    row("roomy", left: 90), row("out", left: 0), row("low", left: 15),
    row("runs-out", left: 60, runOut: now.addingTimeInterval(600)), row("mid", left: 50),
  ]
  #expect(WidgetPreferences().accounts(in: rows, at: now) == ["out", "runs-out", "low"])
  let chosen = WidgetPreferences(accountIDs: ["removed", "roomy"])
  #expect(chosen.accounts(in: rows, at: now) == ["roomy", "out", "runs-out"])
  let full = WidgetPreferences(accountIDs: ["mid", "roomy", "low"])
  #expect(full.accounts(in: rows, at: now) == ["mid", "roomy", "low"])
  #expect(WidgetPreferences().accounts(in: Array(rows.prefix(2)), at: now) == ["out", "roomy"])
  #expect(WidgetPreferences().accounts(in: [], at: now).isEmpty)
}
