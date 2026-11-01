import Foundation
import Testing

@testable import HeadroomKit

/// One reading taken at `observed`, written at `now`.
private let observed = Date(timeIntervalSince1970: 1_000_000)

private func cache(at now: Date, age: String, left: Double) -> WidgetCache {
  let limit = WidgetLimitRow(
    key: "weekly", percentLeft: left, unlimited: false, part: false, interface: "private",
    resetsAt: observed.addingTimeInterval(86_400), runsOutAt: nil, label: "Weekly", left: "",
    reset: "",
    runOut: nil)
  let row = WidgetAccountRow(
    id: "a", sourceName: "Home", name: "Personal", provider: "claude", state: .connected,
    status: age, age: age, observedAt: observed, staleAt: nil, signIn: false, bindingKey: "weekly",
    balance: nil, balanceLabel: nil, balanceInterface: nil, bankedCount: nil, limits: [limit],
    charges: [], banked: nil)
  return WidgetCache(writtenAt: now, rows: [row], sources: [])
}

@Test func aRewriteWithOnlyANewTimeAndAgeIsNotAChange() {
  let now = Date(timeIntervalSince1970: 1_000_000)
  let later = now.addingTimeInterval(60)
  #expect(
    WidgetCacheWriter.sameReadings(
      cache(at: now, age: "now", left: 70), cache(at: later, age: "1 min ago", left: 70)))
  #expect(
    !WidgetCacheWriter.sameReadings(
      cache(at: now, age: "now", left: 70), cache(at: now, age: "now", left: 69)))
}

@Test func aTimelineCarriesOnlyTheNextFewEvents() {
  let now = Date(timeIntervalSince1970: 1_000_000)
  let limits = (1...20).map { index in
    WidgetLimitRow(
      key: "k\(index)", percentLeft: 50, unlimited: false, part: false, interface: "private",
      resetsAt: now.addingTimeInterval(Double(index) * 3600), runsOutAt: nil, label: "L",
      left: "", reset: "", runOut: nil)
  }
  let row = WidgetAccountRow(
    id: "a", sourceName: "Home", name: "Personal", provider: "claude", state: .connected,
    status: "", age: "", observedAt: now, staleAt: nil, signIn: false, bindingKey: nil,
    balance: nil, balanceLabel: nil, balanceInterface: nil, bankedCount: nil, limits: limits,
    charges: [], banked: nil)
  let dates = WidgetTimeline.dates(
    cache: WidgetCache(writtenAt: now, rows: [row], sources: []), now: now)
  #expect(dates.count == 1 + WidgetTimeline.maxEvents)
  #expect(dates == dates.sorted())
}
