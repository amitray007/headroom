import Foundation
import Testing

@testable import HeadroomKit

private let now = Date(timeIntervalSince1970: 1_000_000)
private let utc = TimeZone(identifier: "UTC")!

private func limit(
  _ key: String, left: Double?, reset: TimeInterval?, runOut: TimeInterval? = nil,
  window: String, session: Bool = false
) -> WidgetLimitRow {
  WidgetLimitRow(
    key: key, percentLeft: left, unlimited: false, part: false, interface: "private",
    resetsAt: reset.map { now.addingTimeInterval($0) },
    runsOutAt: runOut.map { now.addingTimeInterval($0) }, label: window, left: "", reset: "",
    runOut: nil, window: window, session: session, notStarted: false)
}

private func row(
  _ id: String, limits: [WidgetLimitRow], keys: [String]?, banked: Double? = nil,
  extra: WidgetExtra? = nil, balance: WidgetBalanceMeter? = nil
) -> WidgetAccountRow {
  WidgetAccountRow(
    id: id, sourceName: "Home", name: "Personal", provider: "claude", state: .connected,
    status: "", age: "", observedAt: now, staleAt: now.addingTimeInterval(3600), signIn: false,
    bindingKey: keys?.last, balance: nil, balanceLabel: nil, balanceInterface: nil,
    bankedCount: banked, limits: limits, charges: [], banked: banked.map { "\($0)" },
    plan: "Max 20x", ledgerKeys: keys, extra: extra, balanceMeter: balance)
}

@Test func forecastRunOutIsARedNoteNotAmberCells() {
  let weekly = limit("weekly", left: 70, reset: 300_000, runOut: 200_000, window: "Weekly")
  let meter = WidgetLedger.meter(weekly, at: now, timeZone: utc)
  #expect(meter.value == "70%")
  #expect(meter.tone == .room)
  #expect(meter.runsOut && meter.alarm)
  #expect(meter.note.hasPrefix("out "))
}

@Test func lowRoomIsAmberAndOutIsHatchedWithItsReturn() {
  let low = WidgetLedger.meter(limit("w", left: 15, reset: 3600, window: "Weekly"), at: now)
  #expect(low.tone == .tight)
  #expect(low.note == "in 1h")
  let out = WidgetLedger.meter(
    limit("s", left: 0, reset: 13_080, window: "Session", session: true), at: now, timeZone: utc)
  #expect(out.tone == .out)
  #expect(out.note.hasPrefix("back "))
  #expect(out.session)
}

@Test func aPassedResetReadsUnknownNeverAFullAllowance() {
  let passed = limit("w", left: 40, reset: -60, window: "Weekly")
  let meter = WidgetLedger.meter(passed, at: now)
  #expect(meter.value == "Unknown")
  #expect(meter.tone == .unknown)
  #expect(meter.fill == nil)
}

@Test func usedShowsTheShareUsedWhileTheToneFollowsRoomLeft() {
  let meter = WidgetLedger.meter(
    limit("w", left: 15, reset: 3600, window: "Weekly"), at: now, used: true)
  #expect(meter.value == "85%")
  #expect(meter.fill == 85)
  #expect(meter.tone == .tight)
}

@Test func oneRowShowsTheLedgerLimitsAndExtraLargeAddsTheRest() {
  let session = limit("session", left: 88, reset: 14_700, window: "Session", session: true)
  let weekly = limit("weekly", left: 70, reset: 300_000, runOut: 200_000, window: "Weekly")
  let fable = limit("fable", left: 100, reset: 400_000, window: "Fable")
  let claude = row("c", limits: [weekly, fable, session], keys: ["session", "weekly"])
  #expect(WidgetLedger.meters(claude, at: now).map(\.label) == ["Session", "Weekly"])
  #expect(
    WidgetLedger.meters(claude, at: now, every: true).map(\.label)
      == ["Session", "Weekly", "Fable"])
  #expect(WidgetLedger.binding(claude)?.key == "weekly")
}

@Test func anAccountWithNoQuotaShowsItsBalance() {
  let vercel = row(
    "v", limits: [], keys: [],
    balance: WidgetBalanceMeter(value: "$42.18", fill: 84, note: "of $50 bought"))
  let meters = WidgetLedger.meters(vercel, at: now)
  #expect(meters.map(\.value) == ["$42.18"])
  #expect(meters.first?.label == "balance")
}

@Test func summaryCountsOutRunsOutAndBankedAndRanksTheTightestFirst() {
  let out = row(
    "out", limits: [limit("s", left: 0, reset: 3600, window: "Session", session: true)],
    keys: ["s"])
  let runs = row(
    "runs", limits: [limit("w", left: 70, reset: 300_000, runOut: 200_000, window: "Weekly")],
    keys: ["w"], banked: 2)
  let calm = row(
    "calm", limits: [limit("w", left: 99, reset: 300_000, window: "Weekly")], keys: ["w"],
    banked: 2)
  let summary = WidgetLedger.summary([calm, runs, out], at: now)
  #expect(summary.out == 1)
  #expect(summary.runsOut == 1)
  #expect(summary.banked == 4)
  #expect(WidgetLedger.tightest([calm, runs, out], at: now).map(\.id) == ["out", "runs", "calm"])
}

@Test func aCacheFromBeforeTheLedgerFallsBackToTheBindingLimit() {
  let weekly = limit("weekly", left: 50, reset: 300_000, window: "Weekly")
  let old = row("o", limits: [weekly], keys: nil)
  #expect(WidgetLedger.meters(old, at: now).map(\.value) == ["50%"])
}
