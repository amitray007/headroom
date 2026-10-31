import Foundation
import HeadroomAPI

/// One popover row: up to two limits (session, then the binding longer window), one extra and,
/// for an account with no quota, its balance. Display-only; money never becomes quota room.
public struct LedgerRow: Identifiable, Sendable {
  public enum Tone: Equatable, Sendable { case room, tight, out, unknown }

  public struct Meter: Equatable, Sendable {
    /// Share of the ten cells to fill, 0...100.
    public let fill: Double?
    public let value: String
    public let label: String
    public let tone: Tone
    /// The right edge: a countdown, a return time or a projected run-out.
    public let note: String
    public let alarm: Bool
    public let runsOut: Bool
  }

  public struct Extra: Equatable, Sendable {
    public let value: String
    public let label: String
  }

  public let column: RoomColumn
  public let meters: [Meter]
  public let extra: Extra?
  /// The time the row was built for, so a view can describe it without reading the clock.
  public let now: Date
  public var item: AccountItem { column.item }
  public var id: String { column.id }

  /// `view` picks room left or the share used for each limit's figure and cells; the tone
  /// always follows room left.
  public init(
    column: RoomColumn, now: Date, timeZone: TimeZone = .current,
    view: DisplayPreferences.LimitsView = .left
  ) {
    self.column = column
    self.now = now
    let account = column.item.account
    let known = account.limits.filter {
      !$0.part && !$0.unlimited && !$0.notStarted && $0.percentLeft?.isFinite == true
    }
    let session = known.filter { $0.windowKind == .session }.min {
      ($0.percentLeft ?? 100) < ($1.percentLeft ?? 100)
    }
    var longer = account
    longer.limits = known.filter { $0.windowKind != .session }
    let period = RoomNow.binding(longer, now: now)
    let limits = [session, period].compactMap { $0 }
    if limits.isEmpty, let balance = Self.balance(account) {
      meters = [balance]
      extra = nil
      return
    }
    meters = limits.map { Self.meter($0, now: now, timeZone: timeZone, view: view) }
    extra = Self.extra(account, now: now, timeZone: timeZone)
  }

  public var outCount: Int { meters.contains { $0.tone == .out } ? 1 : 0 }
  public var lowCount: Int {
    outCount == 0 && meters.contains { $0.tone == .tight } ? 1 : 0
  }

  static func meter(
    _ limit: FeedAccount.limitsPayloadPayload, now: Date, timeZone: TimeZone,
    view: DisplayPreferences.LimitsView = .left
  ) -> Meter {
    let left = min(100, max(0, limit.percentLeft ?? 0))
    // The figure and the cells follow the view; the tone and notes follow room left.
    let shown = view == .left ? left : 100 - left
    let value = Formatting.barePercent(shown)
    let reset = Formatting.date(milliseconds: limit.resetsAt)
    let label = windowLabel(limit)
    if left == 0 {
      return Meter(
        fill: view == .left ? 0 : 100, value: value, label: label, tone: .out,
        note: "back \(Formatting.when(reset, now: now, timeZone: timeZone))", alarm: true,
        runsOut: false)
    }
    if let runOut = RoomNow.projection(limit, now: now) {
      return Meter(
        fill: shown, value: value, label: label, tone: .tight,
        note: "out \(Formatting.when(runOut, now: now, timeZone: timeZone))", alarm: true,
        runsOut: true)
    }
    return Meter(
      fill: shown, value: value, label: label,
      tone: left <= 20 ? .tight : .room,
      note: reset.map { Formatting.countdown(to: $0, now: now) } ?? "", alarm: false,
      runsOut: false)
  }

  /// "Session" and "Weekly" say their window; other labels add it ("Included, billing cycle").
  static func windowLabel(_ limit: FeedAccount.limitsPayloadPayload) -> String {
    guard let window = limit.window, !window.isEmpty,
      !["session", "weekly"].contains(limit.label.lowercased())
    else { return limit.label }
    return "\(limit.label), \(window)"
  }

  /// An account with no quota shows its balance. When the feed also reports what was used, the
  /// cells show the share of everything bought that is still left.
  static func balance(_ account: FeedAccount) -> Meter? {
    guard let charge = account.charges.first(where: { $0.kind == .balance && $0.value != nil }),
      let value = charge.value
    else { return nil }
    let used = account.charges.first {
      $0.key.hasSuffix("total_used") && $0.unit == charge.unit && $0.value != nil
    }?.value
    let bought = used.map { $0 + value }
    let fill = bought.flatMap { $0 > 0 ? min(100, max(0, value / $0 * 100)) : nil }
    return Meter(
      fill: fill, value: Formatting.amount(value, unit: charge.unit), label: "balance",
      tone: fill == nil ? .unknown : .room,
      note: bought.map { "of \(Formatting.amount($0, unit: charge.unit)) bought" } ?? "",
      alarm: false, runsOut: false)
  }

  /// One extra per row, in this order: banked resets, capped spend, then a credit balance.
  static func extra(_ account: FeedAccount, now: Date, timeZone: TimeZone) -> Extra? {
    if let banked = account.banked, let count = banked.count, count > 0 {
      let first = Formatting.date(milliseconds: banked.expiries.first)
      return Extra(
        value: String(format: "%.0f", count),
        label: first.map { "banked · \(Formatting.day($0, now: now, timeZone: timeZone))" }
          ?? "banked")
    }
    if let spend = account.charges.first(where: {
      $0.kind == .spend && $0.cap != nil && $0.value != nil && !$0.unlimited
    }), let value = spend.value, let cap = spend.cap {
      return Extra(
        value: Formatting.amount(value, unit: spend.unit),
        label: "of \(Formatting.amount(cap.value, unit: cap.unit))")
    }
    if let balance = account.charges.first(where: { $0.kind == .balance && $0.value != nil }),
      let value = balance.value
    {
      return Extra(
        value: Formatting.amount(value, unit: balance.unit),
        label: balance.unit == "USD" ? "balance" : Formatting.unitLabel(balance.unit))
    }
    return nil
  }
}

/// The line under the header: plan total, extra spend, banked resets, then out and low counts.
public struct LedgerSummary: Equatable, Sendable {
  public let plans: String?
  public let extraSpend: String?
  public let banked: Int
  public let out: Int
  public let low: Int

  public init(rows: [LedgerRow], feeds: [AppFeed]) {
    let totals = feeds.compactMap(\.summary.monthlyPlanTotal)
    let currencies = Set(totals.map(\.currency.rawValue))
    plans =
      currencies.count == 1
      ? Formatting.amount(
        Double(totals.map(\.minor).reduce(0, +)) / 100, unit: currencies.first!) : nil
    let spend = feeds.flatMap(\.summary.extraSpend).filter { $0.unit == "USD" }
    extraSpend =
      spend.isEmpty || spend.contains { $0.value == nil }
      ? nil : Formatting.amount(spend.compactMap(\.value).reduce(0, +), unit: "USD")
    banked = Int(rows.compactMap { $0.item.account.banked?.count }.reduce(0, +))
    out = rows.map(\.outCount).reduce(0, +)
    low = rows.map(\.lowCount).reduce(0, +)
  }
}
