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
