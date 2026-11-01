import Foundation
import WidgetKit

public struct WidgetAccountRow: Codable, Identifiable, Sendable {
  public let id: String
  public let sourceName: String
  public let name: String
  public let provider: String
  public let state: SourceState
  public let status: String
  public let age: String
  public let observedAt: Date?
  public let staleAt: Date?
  public let signIn: Bool
  public let bindingKey: String?
  public let balance: String?
  public let balanceLabel: String?
  public let balanceInterface: String?
  public let bankedCount: Double?
  public let limits: [WidgetLimitRow]
  public let charges: [String]
  public let banked: String?
  // The ledger, as the popover picks it. Optional so a cache written before them still reads.
  public var plan: String? = nil
  /// The session limit, then the binding longer window: the limits a one-row view shows.
  public var ledgerKeys: [String]? = nil
  /// The one extra pinned right: banked resets, capped spend, then a credit balance.
  public var extra: WidgetExtra? = nil
  /// An account with no quota: its balance as the meter.
  public var balanceMeter: WidgetBalanceMeter? = nil
}

public struct WidgetExtra: Codable, Equatable, Sendable {
  public let value: String
  public let label: String
}

public struct WidgetBalanceMeter: Codable, Equatable, Sendable {
  public let value: String
  public let fill: Double?
  public let note: String
}

public struct WidgetLimitRow: Codable, Identifiable, Sendable {
  public var id: String { key }
  public let key: String
  public let percentLeft: Double?
  public let unlimited: Bool
  public let part: Bool
  public let interface: String
  public let resetsAt: Date?
  public let runsOutAt: Date?
  public let label: String
  public let left: String
  public let reset: String
  public let runOut: String?
  /// The ledger's window name ("Weekly", "Included, monthly").
  public var window: String? = nil
  public var session: Bool? = nil
  public var notStarted: Bool? = nil
}

public struct WidgetSourceRow: Codable, Sendable {
  public let name: String
  public let state: SourceState
}

public struct WidgetCache: Codable, Sendable {
  public let writtenAt: Date
  public let rows: [WidgetAccountRow]
  public let sources: [WidgetSourceRow]
  /// The app's widget settings. Optional so a cache written before them still reads.
  public var settings: WidgetPreferences?
  public init(
    writtenAt: Date, rows: [WidgetAccountRow], sources: [WidgetSourceRow],
    settings: WidgetPreferences? = nil
  ) {
    self.writtenAt = writtenAt
    self.rows = rows
    self.sources = sources
    self.settings = settings
  }
  /// The widget settings, with defaults when the cache has none.
  public var widgetSettings: WidgetPreferences { settings ?? WidgetPreferences() }
}

public struct WidgetCacheWriter: Sendable {
  public let location: WidgetCacheLocation
  public init(location: WidgetCacheLocation = WidgetCacheLocation()) { self.location = location }

  /// The widget kinds that read the Widgets settings; a settings change reloads only these.
  public static let settingsKinds = ["Headroom", "HeadroomAccounts"]

  /// Writes the cache and reloads widget timelines, unless nothing a widget draws changed.
  /// WidgetKit reloads one timeline at a time, so a reload with nothing new delays the next
  /// one that matters, such as a settings change.
  /// - Parameter kinds: reload only these widget kinds; nil reloads every kind.
  /// - Returns: whether the cache changed.
  @discardableResult
  public func write(
    sources: [SourceSnapshot], settings: WidgetPreferences = WidgetPreferences(),
    now: Date = Date(), timeZone: TimeZone = .current, kinds: [String]? = nil
  ) throws -> Bool {
    let cache = Self.cache(sources: sources, settings: settings, now: now, timeZone: timeZone)
    if let previous = try? read(), Self.sameReadings(previous, cache) { return false }
    try HeadroomStorage.write(cache, to: location.url)
    // Reload only after the atomic write succeeds, including source removal and empty feeds.
    if let kinds {
      kinds.forEach { WidgetCenter.shared.reloadTimelines(ofKind: $0) }
    } else {
      WidgetCenter.shared.reloadAllTimelines()
    }
    return true
  }

  /// Equal apart from the write time and the age and status texts, which widgets work out
  /// again at each timeline date.
  static func sameReadings(_ a: WidgetCache, _ b: WidgetCache) -> Bool {
    func key(_ cache: WidgetCache) -> Data? {
      guard let data = try? JSONEncoder().encode(cache),
        var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { return nil }
      object["writtenAt"] = nil
      object["rows"] = (object["rows"] as? [[String: Any]])?.map { row in
        row.filter { $0.key != "age" && $0.key != "status" }
      }
      return try? JSONSerialization.data(withJSONObject: object, options: .sortedKeys)
    }
    guard let left = key(a), let right = key(b) else { return false }
    return left == right
  }

  /// The cache as written, also for the Widgets settings preview.
  public static func cache(
    sources: [SourceSnapshot], settings: WidgetPreferences = WidgetPreferences(),
    now: Date = Date(), timeZone: TimeZone = .current
  ) -> WidgetCache {
    let rows = sources.flatMap { source -> [WidgetAccountRow] in
      guard let feed = source.cached?.feed else { return [] }
      return feed.accounts.map { account in
        let balance = account.charges.first { $0.kind == .balance }
        let success = Formatting.date(milliseconds: account.lastSuccessAt)
        return WidgetAccountRow(
          id: AccountItem.widgetID(sourceID: source.id, accountID: account.id),
          sourceName: source.source.name,
          name: account.name, provider: account.provider.rawValue, state: source.state,
          status: Formatting.status(
            account, staleAfterMs: feed.staleAfterMs, now: now, timeZone: timeZone),
          age: Formatting.age(Formatting.date(milliseconds: account.observedAt), now: now),
          observedAt: Formatting.date(milliseconds: account.observedAt),
          staleAt: success?.addingTimeInterval(Double(feed.staleAfterMs) / 1000),
          signIn: account.state == .reconnect_required,
          bindingKey: Presentation.binding(account)?.key,
          balance: balance.map { Formatting.charge($0) }, balanceLabel: balance?.label,
          balanceInterface: balance?.interface.rawValue,
          bankedCount: account.banked?.count,
          limits: account.limits.map { limit in
            WidgetLimitRow(
              key: limit.key, percentLeft: limit.percentLeft, unlimited: limit.unlimited,
              part: limit.part, interface: limit.interface.rawValue,
              resetsAt: Formatting.date(milliseconds: limit.resetsAt),
              runsOutAt: Formatting.date(milliseconds: limit.runsOutAt),
              label: Presentation.limitLabel(limit, in: account),
              left: limit.unlimited ? "Unlimited" : Formatting.percentLeft(limit.percentLeft),
              reset: Formatting.when(
                Formatting.date(milliseconds: limit.resetsAt), now: now, timeZone: timeZone),
              runOut: Formatting.date(milliseconds: limit.runsOutAt).map {
                Formatting.runOut($0, now: now, timeZone: timeZone)
              },
              window: LedgerRow.windowLabel(limit), session: limit.windowKind == .session,
              notStarted: limit.notStarted
            )
          },
          charges: account.charges.map { "\($0.label): \(Formatting.charge($0))" },
          banked: account.banked.map { Formatting.inventory($0.count, unit: $0.unit) },
          plan: account.plan,
          ledgerKeys: LedgerRow.limits(account, now: now).map(\.key),
          // With no quota the balance is the meter, so it is not repeated as the extra.
          extra: LedgerRow.limits(account, now: now).isEmpty && LedgerRow.balance(account) != nil
            ? nil
            : LedgerRow.extra(account, now: now, timeZone: timeZone).map {
              WidgetExtra(value: $0.value, label: $0.label)
            },
          balanceMeter: LedgerRow.balance(account).map {
            WidgetBalanceMeter(value: $0.value, fill: $0.fill, note: $0.note)
          }
        )
      }
    }
    return WidgetCache(
      writtenAt: now, rows: rows,
      sources: sources.map { WidgetSourceRow(name: $0.source.name, state: $0.state) },
      settings: settings)
  }

  public func read() throws -> WidgetCache? {
    try HeadroomStorage.read(WidgetCache.self, at: location.url)
  }
}
