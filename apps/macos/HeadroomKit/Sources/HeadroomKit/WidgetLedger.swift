import Foundation

/// The round 10 ledger widgets, from the widget cache at a timeline date: ten cells per limit,
/// the figure and window on the left, a countdown, return time or forecast run-out on the right.
/// Amber means little room left; a forecast run-out is a red dot and red note, not amber.
public enum WidgetLedger {
  /// Amber at or below this share left, as in the popover.
  static let low: Double = 20

  /// The ledger's limits for one row: the session, then the binding longer window.
  public static func limits(_ row: WidgetAccountRow) -> [WidgetLimitRow] {
    let keyed = (row.ledgerKeys ?? []).compactMap { key in row.limits.first { $0.key == key } }
    if !keyed.isEmpty { return keyed }
    // A cache from before the ledger: the binding limit alone.
    return [row.limits.first { $0.key == row.bindingKey } ?? row.limits.first { !$0.part }]
      .compactMap { $0 }
  }

  /// Every limit worth a meter, ledger limits first, for the Extra large widget.
  public static func everyLimit(_ row: WidgetAccountRow) -> [WidgetLimitRow] {
    let first = limits(row)
    let rest = row.limits.filter { limit in
      !limit.part && !limit.unlimited && limit.notStarted != true
        && !first.contains { $0.key == limit.key }
    }
    return first + rest
  }

  /// The limit the row is judged by: the longer window when there is one.
  public static func binding(_ row: WidgetAccountRow) -> WidgetLimitRow? {
    let all = limits(row)
    return all.first { $0.session != true } ?? all.first
  }

  public static func meter(
    _ limit: WidgetLimitRow, at date: Date, timeZone: TimeZone = .current, used: Bool = false
  ) -> LedgerRow.Meter {
    let label = limit.window ?? limit.label
    let session = limit.session == true
    guard let left = WidgetTimeline.percent(limit, at: date).map({ min(100, max(0, $0)) }) else {
      // A passed reset or an unread limit: never a made-up full allowance.
      let passed = limit.resetsAt.map { $0 <= date } ?? false
      return LedgerRow.Meter(
        fill: nil, value: "Unknown", label: label, tone: .unknown,
        note: passed ? "read needed" : "", alarm: false, runsOut: false, session: session)
    }
    let shown = used ? 100 - left : left
    let value = Formatting.barePercent(shown)
    if left == 0 {
      return LedgerRow.Meter(
        fill: shown, value: value, label: label, tone: .out,
        note: "back \(Formatting.when(limit.resetsAt, now: date, timeZone: timeZone))",
        alarm: true, runsOut: false, session: session)
    }
    let tone: LedgerRow.Tone = left <= low ? .tight : .room
    if let runOut = limit.runsOutAt, runOut > date, limit.resetsAt.map({ runOut < $0 }) ?? true {
      return LedgerRow.Meter(
        fill: shown, value: value, label: label, tone: tone,
        note: "out \(Formatting.when(runOut, now: date, timeZone: timeZone))", alarm: true,
        runsOut: true, session: session)
    }
    return LedgerRow.Meter(
      fill: shown, value: value, label: label, tone: tone,
      note: limit.resetsAt.map { Formatting.countdown(to: $0, now: date) } ?? "", alarm: false,
      runsOut: false, session: session)
  }

  /// An account with no quota: its balance against what was bought.
  public static func balance(_ row: WidgetAccountRow) -> LedgerRow.Meter? {
    guard let balance = row.balanceMeter else { return nil }
    return LedgerRow.Meter(
      fill: balance.fill, value: balance.value, label: "balance",
      tone: balance.fill == nil ? .unknown : .room, note: balance.note, alarm: false,
      runsOut: false)
  }

  /// The one-row meters: the ledger limits, or the balance when there are none.
  public static func meters(
    _ row: WidgetAccountRow, at date: Date, timeZone: TimeZone = .current, used: Bool = false,
    every: Bool = false
  ) -> [LedgerRow.Meter] {
    let shown = every ? everyLimit(row) : limits(row)
    if shown.isEmpty { return balance(row).map { [$0] } ?? [] }
    return shown.map { meter($0, at: date, timeZone: timeZone, used: used) }
  }

  /// The count line: accounts out now, accounts forecast to run out, and banked resets.
  public struct Summary: Equatable, Sendable {
    public let out: Int
    public let runsOut: Int
    public let signIn: Int
    /// Nil when a reset inventory is reported without a count.
    public let banked: Int?
    public let low: Int
  }

  public static func summary(_ rows: [WidgetAccountRow], at date: Date) -> Summary {
    let perRow = rows.map { meters($0, at: date) }
    let out = perRow.filter { $0.contains { $0.tone == .out } }.count
    let runs = perRow.filter { row in
      !row.contains { $0.tone == .out } && row.contains(where: \.runsOut)
    }.count
    let low = perRow.filter { row in
      !row.contains { $0.tone == .out } && row.contains { $0.tone == .tight }
    }.count
    let unknownBanked = rows.contains { $0.banked != nil && $0.bankedCount == nil }
    return Summary(
      out: out, runsOut: runs, signIn: rows.filter(\.signIn).count,
      banked: unknownBanked ? nil : Int(rows.compactMap(\.bankedCount).reduce(0, +)), low: low)
  }

  /// Rows by how soon they need attention: out, then forecast run-out, then least room left.
  public static func tightest(_ rows: [WidgetAccountRow], at date: Date) -> [WidgetAccountRow] {
    func rank(_ row: WidgetAccountRow) -> (Int, Double) {
      let all = meters(row, at: date)
      if all.contains(where: { $0.tone == .out }) { return (0, 0) }
      let left = binding(row).flatMap { WidgetTimeline.percent($0, at: date) } ?? 101
      if all.contains(where: \.runsOut) { return (1, left) }
      return (2, left)
    }
    return rows.enumerated().sorted { a, b in
      let ra = rank(a.element)
      let rb = rank(b.element)
      return ra != rb ? ra < rb : a.offset < b.offset
    }.map(\.element)
  }
}
