import Foundation

public struct WidgetCacheLocation: Sendable {
  public let url: URL

  public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) {
    url = homeDirectory.appending(
      path:
        "Library/Containers/club.theblank.headroom.mac.widgets/Data/Library/Application Support/Headroom/widget-cache.json"
    )
  }

  /// The sandbox resolves Application Support inside this widget's own container.
  public static var ownContainer: WidgetCacheLocation {
    WidgetCacheLocation(url: HeadroomStorage.directory.appending(path: "widget-cache.json"))
  }

  public init(url: URL) { self.url = url }
}

public struct WidgetAccountRow: Codable, Identifiable, Sendable {
  public let id: String
  public let sourceName: String
  public let name: String
  public let provider: String
  public let state: SourceState
  public let status: String
  public let age: String
  public let limits: [WidgetLimitRow]
  public let charges: [String]
  public let banked: String?
}

public struct WidgetLimitRow: Codable, Sendable {
  public let label: String
  public let left: String
  public let reset: String
  public let runOut: String?
}

public struct WidgetCache: Codable, Sendable {
  public let writtenAt: Date
  public let rows: [WidgetAccountRow]
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
        WidgetAccountRow(
          id: "\(source.id.uuidString):\(account.id)", sourceName: source.source.name,
          name: account.name, provider: account.provider.rawValue, state: source.state,
          status: Formatting.status(
            account, staleAfterMs: feed.staleAfterMs, now: now, timeZone: timeZone),
          age: Formatting.age(Formatting.date(milliseconds: account.observedAt), now: now),
          limits: account.limits.map { limit in
            WidgetLimitRow(
              label: limit.label,
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
    try HeadroomStorage.write(WidgetCache(writtenAt: now, rows: rows), to: location.url)
  }

  public func read() throws -> WidgetCache? {
    try HeadroomStorage.read(WidgetCache.self, at: location.url)
  }
}
