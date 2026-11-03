import Foundation

public enum WidgetTimeline {
  static let maxEvents = 6

  /// Event entries keep reset and forecast labels current without a running app.
  /// The last reading stays a reading: a passed reset never invents a full allowance.
  public static func dates(cache: WidgetCache?, now: Date) -> [Date] {
    let rows = cache?.rows ?? []
    let events = rows.flatMap { row in
      row.limits.flatMap { [$0.resetsAt, $0.runsOutAt].compactMap { $0 } }
        + [row.staleAt].compactMap { $0 }
    }
    // WidgetKit asks again within minutes, and draws every entry it is given up front; the
    // next few events keep wording right without making each reload slow.
    return [now] + Set(events.filter { $0 > now }).sorted().prefix(maxEvents)
  }

  public static func percent(_ limit: WidgetLimitRow, at date: Date) -> Double? {
    if let reset = limit.resetsAt, reset <= date { return nil }
    return limit.percentLeft
  }

  public static func next(_ limit: WidgetLimitRow, at date: Date, timeZone: TimeZone = .current)
    -> String
  {
    if let reset = limit.resetsAt, reset <= date { return "Reset passed · read needed" }
    guard limit.percentLeft != nil || limit.unlimited else { return "Unknown" }
    if limit.percentLeft == 0 {
      return "Back \(Formatting.when(limit.resetsAt, now: date, timeZone: timeZone))"
    }
    if let runOut = limit.runsOutAt {
      return runOut <= date
        ? "May be out if pace holds"
        : "Runs out \(Formatting.when(runOut, now: date, timeZone: timeZone))"
    }
    return limit.resetsAt.map { "Resets \(Formatting.when($0, now: date, timeZone: timeZone))" }
      ?? ""
  }
}
