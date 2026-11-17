import Foundation

public enum Formatting {
  /// Built once: a `Locale` is costly to create and every figure on screen is formatted with it.
  static let gb = Locale(identifier: "en_GB")

  public static func left(used: Double?) -> Double? { used.map { max(0, 100 - $0) } }

  public static func percentLeft(_ value: Double?) -> String {
    guard let value, value.isFinite else { return "Unknown" }
    return "\(barePercent(value)) left"
  }

  /// The figure a limit shows: room left, or the share used. Nil stays nil.
  public static func shown(_ left: Double?, view: DisplayPreferences.LimitsView) -> Double? {
    guard let left, left.isFinite else { return nil }
    return view == .left ? left : 100 - left
  }

  /// "37% left" or "63% used".
  public static func share(_ left: Double?, view: DisplayPreferences.LimitsView) -> String {
    guard let value = shown(left, view: view) else { return "Unknown" }
    return "\(barePercent(value)) \(view == .left ? "left" : "used")"
  }

  public static func barePercent(_ value: Double?) -> String {
    guard let value, value.isFinite else { return "Unknown" }
    let rounded = value > 0 && value < 100 ? min(99, max(1, value.rounded())) : value.rounded()
    // Whole numbers only: integer text is far cheaper than `String(format:)`, and every meter
    // formats one on every redraw.
    return "\(Int(rounded))%"
  }

  public static func unitTotal(_ values: [Double?], unit: String) -> String {
    let label = unitLabel(unit)
    return values.contains { $0 == nil || $0?.isFinite == false }
      ? "\(label) unknown" : money(values.compactMap { $0 }.reduce(0, +), unit: label)
  }

  /// Whole numbers as they are; anything else to two decimals, so a credit balance reads
  /// "61,068.39", not "61068.3876350001".
  private static func number(_ value: Double) -> String {
    String(format: value.rounded() == value ? "%.0f" : "%.2f", locale: gb, value)
  }

  public static func money(_ value: Double?, unit: String) -> String {
    guard let value, value.isFinite else { return "Unknown" }
    return "\(String(format: "%.2f", locale: gb, value)) \(unit)"
  }

  public static func unitLabel(_ unit: String) -> String {
    switch unit {
    case "codex_credits": "Codex credits"
    case "grok_credits": "Grok credits"
    case "gateway_credits": "Gateway credits"
    default: unit
    }
  }

  public static func charge(_ charge: FeedCharge) -> String {
    if charge.unlimited { return "Unlimited" }
    guard let value = charge.value else {
      return charge.availability == .not_authorized ? "Not on this plan" : "Unknown"
    }
    func amount(_ value: Double, _ unit: String) -> String {
      unit == "USD" ? String(format: "%.2f", locale: gb, value) : number(value)
    }
    let text = amount(value, charge.unit)
    guard let cap = charge.cap else { return "\(text) \(unitLabel(charge.unit))" }
    let capText = amount(cap.value, cap.unit)
    return cap.unit == charge.unit
      ? "\(text) / \(capText) \(unitLabel(charge.unit))"
      : "\(text) \(unitLabel(charge.unit)) / \(capText) \(unitLabel(cap.unit))"
  }

  public static func inventory(_ count: Double?, unit: String) -> String {
    "\(count.map(number) ?? "Unknown") \(unit)"
  }

  public static func duration(_ seconds: TimeInterval) -> String {
    let minutes = max(0, Int((seconds / 60).rounded()))
    let days = minutes / 1440
    let hours = (minutes % 1440) / 60
    let remainder = minutes % 60
    if days > 0 {
      return "\(days) \(days == 1 ? "day" : "days")" + (hours > 0 ? " \(hours) h" : "")
    }
    if hours > 0 { return "\(hours) h" + (remainder > 0 ? " \(remainder) min" : "") }
    return "\(remainder) min"
  }

  /// A compact countdown for the popover rows: "in 2h 10m", "in 6d 17h", "in 45m".
  public static func countdown(to date: Date, now: Date = Date()) -> String {
    let minutes = max(0, Int((date.timeIntervalSince(now) / 60).rounded()))
    let days = minutes / 1440
    let hours = (minutes % 1440) / 60
    let remainder = minutes % 60
    if minutes == 0 { return "now" }
    if days > 0 { return "in \(days)d" + (hours > 0 ? " \(hours)h" : "") }
    if hours > 0 { return "in \(hours)h" + (remainder > 0 ? " \(remainder)m" : "") }
    return "in \(remainder)m"
  }

  /// Money with its symbol ("$3.20", "$20"); any other unit as a bare number ("579.74").
  public static func amount(_ value: Double, unit: String) -> String {
    let symbols = ["USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥"]
    let text =
      value.rounded() == value
      ? String(format: "%.0f", locale: gb, value)
      : String(format: "%.2f", locale: gb, value)
    if let symbol = symbols[unit] { return symbol + text }
    return ["CAD", "AUD", "SGD", "CHF", "BRL"].contains(unit) ? "\(unit) \(text)" : text
  }

  /// A weekday within the coming week, otherwise a date: "Sat", "12 Nov".
  public static func day(_ date: Date, now: Date = Date(), timeZone: TimeZone = .current)
    -> String
  {
    format(
      date, pattern: date.timeIntervalSince(now) < 6 * 86400 ? "EEE" : "d MMM", timeZone: timeZone)
  }

  /// The footer's last check: "just now", then seconds, then `age`. Meant to tick each second.
  public static func checked(_ date: Date?, now: Date = Date()) -> String {
    guard let date else { return "Unknown" }
    let seconds = Int(max(0, now.timeIntervalSince(date)))
    if seconds < 5 { return "just now" }
    if seconds < 60 { return "\(seconds) sec ago" }
    return age(date, now: now)
  }

  public static func age(_ date: Date?, now: Date = Date()) -> String {
    guard let date else { return "Unknown" }
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 3600 { return "\(max(1, Int((seconds / 60).rounded()))) min ago" }
    if seconds < 86400 { return "\(Int((seconds / 3600).rounded())) h ago" }
    let days = Int(seconds / 86400)
    return "\(days) \(days == 1 ? "day" : "days") ago"
  }

  /// Time since, without "ago", for a list's time column: "2 min", "9 h", "5 d".
  public static func elapsed(_ date: Date, now: Date = Date()) -> String {
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 3600 { return "\(max(1, Int((seconds / 60).rounded()))) min" }
    if seconds < 86400 { return "\(Int((seconds / 3600).rounded())) h" }
    return "\(Int(seconds / 86400)) d"
  }

  public static func clock(_ date: Date, timeZone: TimeZone = .current, twelveHour: Bool = false)
    -> String
  {
    format(date, pattern: twelveHour ? "h:mm a" : "HH:mm", timeZone: timeZone)
  }

  public static func when(_ date: Date?, now: Date = Date(), timeZone: TimeZone = .current)
    -> String
  {
    guard let date else { return "Unknown" }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    if calendar.isDate(date, inSameDayAs: now) { return clock(date, timeZone: timeZone) }
    let midnight =
      calendar.component(.hour, from: date) == 0 && calendar.component(.minute, from: date) == 0
    let pattern = date.timeIntervalSince(now) < 6 * 86400 && !midnight ? "EEE HH:mm" : "EEE d MMM"
    return format(date, pattern: pattern, timeZone: timeZone)
  }

  public static func runOut(_ date: Date, now: Date = Date(), timeZone: TimeZone = .current)
    -> String
  {
    "Runs out \(when(date, now: now, timeZone: timeZone)) if the pace holds"
  }

  public static func date(milliseconds: Int?) -> Date? {
    milliseconds.map { Date(timeIntervalSince1970: Double($0) / 1000) }
  }

  private static let formatters = FormatterCache()

  static func format(_ date: Date, pattern: String, timeZone: TimeZone) -> String {
    formatters.string(date, pattern: pattern, timeZone: timeZone)
  }

  public static func status(
    _ account: FeedAccount, staleAfterMs: Int, now: Date = Date(), timeZone: TimeZone = .current
  ) -> String {
    if account.state == .reconnect_required { return "Sign in again" }
    if let success = date(milliseconds: account.lastSuccessAt),
      now.timeIntervalSince(success) * 1000 > Double(staleAfterMs)
    {
      return "Stale, \(age(date(milliseconds: account.observedAt), now: now))"
    }
    let limits = account.limits.filter { !$0.part && $0.percentLeft != nil }
    let exhausted = limits.filter { $0.percentLeft == 0 }.max {
      ($0.resetsAt ?? 0) < ($1.resetsAt ?? 0)
    }
    if let exhausted {
      return
        "Out until \(when(date(milliseconds: exhausted.resetsAt), now: now, timeZone: timeZone))"
    }
    let projected = limits.filter { $0.runsOutAt != nil }.min {
      ($0.runsOutAt ?? 0) < ($1.runsOutAt ?? 0)
    }
    if let projectedDate = date(milliseconds: projected?.runsOutAt) {
      return runOut(projectedDate, now: now, timeZone: timeZone)
    }
    if let binding = limits.min(by: { ($0.percentLeft ?? 100) < ($1.percentLeft ?? 100) }) {
      return percentLeft(binding.percentLeft)
    }
    return account.charges.contains { $0.kind == .balance && $0.value != nil }
      ? "Balance only" : "Unknown"
  }
}

/// A `DateFormatter` costs far more to create than to use, and the popover formats several
/// dates per row on every render. One formatter per pattern and time zone is kept.
private final class FormatterCache: @unchecked Sendable {
  private let lock = NSLock()
  private var formatters: [String: DateFormatter] = [:]

  func string(_ date: Date, pattern: String, timeZone: TimeZone) -> String {
    lock.lock()
    defer { lock.unlock() }
    let key = "\(pattern)|\(timeZone.identifier)"
    if let formatter = formatters[key] { return formatter.string(from: date) }
    let formatter = DateFormatter()
    formatter.locale = Formatting.gb
    formatter.timeZone = timeZone
    formatter.dateFormat = pattern
    formatters[key] = formatter
    return formatter.string(from: date)
  }
}
