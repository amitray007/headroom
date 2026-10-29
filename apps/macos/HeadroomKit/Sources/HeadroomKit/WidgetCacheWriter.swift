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
}

public struct WidgetSourceRow: Codable, Sendable {
  public let name: String
  public let state: SourceState
}

public struct WidgetCache: Codable, Sendable {
  public let writtenAt: Date
  public let rows: [WidgetAccountRow]
  public let sources: [WidgetSourceRow]
  public init(writtenAt: Date, rows: [WidgetAccountRow], sources: [WidgetSourceRow]) {
    self.writtenAt = writtenAt
    self.rows = rows
    self.sources = sources
  }
}

public struct WidgetCacheWriter: Sendable {
  public let location: WidgetCacheLocation
  public init(location: WidgetCacheLocation = WidgetCacheLocation()) { self.location = location }

  public func write(sources: [SourceSnapshot], now: Date = Date(), timeZone: TimeZone = .current)
    throws
  {
    let rows = sources.flatMap { source -> [WidgetAccountRow] in
      guard let feed = source.cached?.feed else { return [] }
      return feed.accounts.map { account in
        let balance = account.charges.first { $0.kind == .balance }
        let success = Formatting.date(milliseconds: account.lastSuccessAt)
        return WidgetAccountRow(
          id: "\(source.id.uuidString):\(account.id)", sourceName: source.source.name,
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
              }
            )
          },
          charges: account.charges.map { "\($0.label): \(Formatting.charge($0))" },
          banked: account.banked.map { Formatting.inventory($0.count, unit: $0.unit) }
        )
      }
    }
    try HeadroomStorage.write(
      WidgetCache(
        writtenAt: now, rows: rows,
        sources: sources.map { WidgetSourceRow(name: $0.source.name, state: $0.state) }),
      to: location.url)
    // Reload only after the atomic write succeeds, including source removal and empty feeds.
    WidgetCenter.shared.reloadAllTimelines()
  }

  public func read() throws -> WidgetCache? {
    try HeadroomStorage.read(WidgetCache.self, at: location.url)
  }
}
