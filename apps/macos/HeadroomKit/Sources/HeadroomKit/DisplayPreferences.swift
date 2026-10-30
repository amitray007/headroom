import Foundation
import HeadroomAPI

public struct DisplayPreferences: Codable, Equatable, Sendable {
  public enum ItemStyle: String, Codable, CaseIterable, Sendable {
    case logoAndPercentage, percentage, logoAndBadge, pinned
    public var label: String {
      switch self {
      case .logoAndPercentage: "Logo and percentage"
      case .percentage: "Percentage only"
      case .logoAndBadge: "Logo and badge"
      case .pinned: "Pinned account"
      }
    }
  }
  public enum Appearance: String, Codable, CaseIterable, Sendable { case system, light, dark }
  public var itemStyle: ItemStyle = .logoAndPercentage
  public var followedAccount: String?
  public var hiddenAccounts: Set<String> = []
  public var accountOrder: [String] = []
  public var appearance: Appearance = .system
  /// Blur account emails until the pointer is over the row.
  public var privacy = false
  /// Show made-up accounts and notices, for screenshots and screen sharing.
  public var demo = false
  /// The popover shows only this source; nil, or a source that no longer exists, shows all.
  public var sourceFilter: UUID?
  public init() {}

  // Files saved before a field existed still load, with that field at its default.
  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = DisplayPreferences()
    itemStyle = try values.decodeIfPresent(ItemStyle.self, forKey: .itemStyle) ?? defaults.itemStyle
    followedAccount = try values.decodeIfPresent(String.self, forKey: .followedAccount)
    hiddenAccounts = try values.decodeIfPresent(Set<String>.self, forKey: .hiddenAccounts) ?? []
    accountOrder = try values.decodeIfPresent([String].self, forKey: .accountOrder) ?? []
    appearance =
      try values.decodeIfPresent(Appearance.self, forKey: .appearance) ?? defaults.appearance
    privacy = try values.decodeIfPresent(Bool.self, forKey: .privacy) ?? false
    demo = try values.decodeIfPresent(Bool.self, forKey: .demo) ?? false
    sourceFilter = try values.decodeIfPresent(UUID.self, forKey: .sourceFilter)
  }
}

public actor DisplayPreferenceStore {
  private let file: URL
  public init(directory: URL = HeadroomStorage.directory) {
    file = directory.appending(path: "display.json")
  }
  public func load() throws -> DisplayPreferences {
    try HeadroomStorage.read(DisplayPreferences.self, at: file) ?? DisplayPreferences()
  }
  public func save(_ value: DisplayPreferences) throws {
    try HeadroomStorage.write(value, to: file)
  }
}

public struct AccountItem: Identifiable, Sendable {
  public let snapshot: SourceSnapshot
  public let account: FeedAccount
  public var id: String { Self.key(sourceID: snapshot.id, accountID: account.id) }
  public static func key(sourceID: UUID, accountID: String) -> String {
    "\(sourceID.uuidString)/\(accountID)"
  }
  public init(snapshot: SourceSnapshot, account: FeedAccount) {
    self.snapshot = snapshot
    self.account = account
  }
  public var providerName: String { Presentation.providerName(account.provider.rawValue) }
  public var name: String { "\(providerName) \(account.name)" }
  public var binding: FeedAccount.limitsPayloadPayload? { Presentation.binding(account) }
}

public enum Presentation {
  public static func providerName(_ id: String) -> String {
    switch id {
    case "claude": "Claude"
    case "codex": "Codex"
    case "cursor": "Cursor"
    case "copilot": "Copilot"
    case "grok": "Grok"
    case "antigravity": "Antigravity"
    case "vercel_ai_gateway": "Vercel AI Gateway"
    default: id
    }
  }

  public static func limitLabel(_ limit: FeedAccount.limitsPayloadPayload, in account: FeedAccount)
    -> String
  {
    guard account.limits.filter({ $0.label == limit.label }).count > 1,
      let window = limit.window, !window.isEmpty,
      limit.key.hasPrefix("limits.")
    else { return limit.label }
    return window
  }

  public static func binding(_ account: FeedAccount) -> FeedAccount.limitsPayloadPayload? {
    let known = account.limits.filter { !$0.part && $0.percentLeft != nil && !$0.unlimited }
    if let out = known.filter({ $0.percentLeft == 0 }).max(by: {
      ($0.resetsAt ?? 0) < ($1.resetsAt ?? 0)
    }) {
      return out
    }
    if let projected = known.filter({ $0.runsOutAt != nil }).min(by: {
      ($0.runsOutAt ?? 0) < ($1.runsOutAt ?? 0)
    }) {
      return projected
    }
    return known.min { ($0.percentLeft ?? 100) < ($1.percentLeft ?? 100) }
  }

  public static func accounts(
    _ sources: [SourceSnapshot], preferences: DisplayPreferences,
    includeHidden: Bool = false
  ) -> [AccountItem] {
    let all = sources.flatMap { snapshot in
      (snapshot.cached?.feed.accounts ?? []).map { AccountItem(snapshot: snapshot, account: $0) }
    }
    let rank = Dictionary(
      preferences.accountOrder.enumerated().map { ($0.element, $0.offset) },
      uniquingKeysWith: min)
    return all.enumerated().filter {
      includeHidden || !preferences.hiddenAccounts.contains($0.element.id)
    }
    .sorted {
      (rank[$0.element.id] ?? (rank.count + $0.offset))
        < (rank[$1.element.id] ?? (rank.count + $1.offset))
    }.map(\.element)
  }

  public static func needsSource(_ item: AccountItem, among items: [AccountItem]) -> Bool {
    item.snapshot.state != .connected
      || items.contains {
        $0.id != item.id && $0.account.provider == item.account.provider
          && $0.account.name == item.account.name && $0.account.plan == item.account.plan
      }
  }

  /// Dashboard navigation always stays on the configured source. Feed URLs cannot redirect a token
  /// recovery or an account link to another host. Opening a browser never carries the API token.
  public static func dashboard(_ source: Source, accountID: String? = nil)
    -> URL
  {
    guard accountID != nil else { return source.baseURL }
    // The web app routes by hash. It has no per-account or Devices URL yet.
    var components = URLComponents(url: source.baseURL, resolvingAgainstBaseURL: false)
    components?.fragment = "/detailed"
    return components?.url ?? source.baseURL
  }
}
