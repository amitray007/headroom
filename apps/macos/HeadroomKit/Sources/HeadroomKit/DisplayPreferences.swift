import Foundation
import HeadroomAPI

public struct DisplayPreferences: Codable, Equatable, Sendable {
  public enum ItemStyle: String, Codable, CaseIterable, Sendable {
    case logo, logoAndRoom, liveLogo, dots, accounts
    public var label: String {
      switch self {
      case .logo: "Logo"
      case .logoAndRoom: "Logo and room"
      case .liveLogo: "Live logo"
      case .dots: "Dots"
      case .accounts: "Accounts"
      }
    }
    /// Live logo, Dots and Accounts show every slot; Logo and room follows the first one.
    public var showsSlots: Bool { self == .liveLogo || self == .dots || self == .accounts }

    /// Styles saved by earlier versions: the percentage styles become Logo and room, the badge
    /// becomes Logo and a pinned account becomes one Accounts slot.
    init(saved: String) {
      switch saved {
      case "logoAndBadge": self = .logo
      case "pinned": self = .accounts
      default: self = ItemStyle(rawValue: saved) ?? .logoAndRoom
      }
    }
  }

  /// One account in the menu bar item, with the look it takes in the Accounts style.
  public struct MenuSlot: Codable, Equatable, Sendable {
    public enum Look: String, Codable, CaseIterable, Sendable { case percent, ring, bars }
    /// An account key, or nil for the tightest account with room that no other slot shows.
    public var account: String?
    public var look: Look
    public init(account: String? = nil, look: Look = .percent) {
      self.account = account
      self.look = look
    }
  }
  public static let maxSlots = 3

  public enum Appearance: String, Codable, CaseIterable, Sendable { case system, light, dark }
  /// Show each limit's room left or its share used, as the web's Limits view does. Colors
  /// still follow room left.
  public enum LimitsView: String, Codable, CaseIterable, Sendable { case left, used }
  public var limitsView: LimitsView = .left
  public var itemStyle: ItemStyle = .logoAndRoom
  /// One to three slots, left to right in the menu bar and top to bottom in a one-icon style.
  public var slots: [MenuSlot] = [MenuSlot()] {
    didSet { if slots.count > Self.maxSlots { slots = Array(slots.prefix(Self.maxSlots)) } }
  }
  /// Each Accounts slot starts with its provider's mark.
  public var providerLogos = true
  /// Yellow when an account runs low, red when it is out; off keeps the menu bar's color.
  public var colorLowOut = true
  /// Live logo adds the figure of the slot with least room beside the glyph.
  public var liveRoom = false
  /// How often this Mac reads its sources while the popover is closed, in seconds. While it is
  /// open the app reads every 30 seconds, or sooner when this is shorter.
  public var checkSeconds = 120
  public static let checkOptions = [30, 60, 120, 300, 600]
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

  private enum Saved: String, CodingKey { case followedAccount }

  // Files saved before a field existed still load, with that field at its default.
  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    let saved = try decoder.container(keyedBy: Saved.self)
    let defaults = DisplayPreferences()
    itemStyle =
      try values.decodeIfPresent(String.self, forKey: .itemStyle).map(ItemStyle.init(saved:))
      ?? defaults.itemStyle
    let followed = try saved.decodeIfPresent(String.self, forKey: .followedAccount)
    let slots = try values.decodeIfPresent([MenuSlot].self, forKey: .slots) ?? []
    self.slots =
      slots.isEmpty ? [MenuSlot(account: followed)] : Array(slots.prefix(Self.maxSlots))
    providerLogos =
      try values.decodeIfPresent(Bool.self, forKey: .providerLogos) ?? defaults.providerLogos
    colorLowOut =
      try values.decodeIfPresent(Bool.self, forKey: .colorLowOut) ?? defaults.colorLowOut
    liveRoom = try values.decodeIfPresent(Bool.self, forKey: .liveRoom) ?? defaults.liveRoom
    limitsView =
      try values.decodeIfPresent(LimitsView.self, forKey: .limitsView) ?? defaults.limitsView
    checkSeconds =
      try values.decodeIfPresent(Int.self, forKey: .checkSeconds)
      .flatMap { Self.checkOptions.contains($0) ? $0 : nil } ?? defaults.checkSeconds
    hiddenAccounts = try values.decodeIfPresent(Set<String>.self, forKey: .hiddenAccounts) ?? []
    accountOrder = try values.decodeIfPresent([String].self, forKey: .accountOrder) ?? []
    appearance =
      try values.decodeIfPresent(Appearance.self, forKey: .appearance) ?? defaults.appearance
    privacy = try values.decodeIfPresent(Bool.self, forKey: .privacy) ?? defaults.privacy
    demo = try values.decodeIfPresent(Bool.self, forKey: .demo) ?? defaults.demo
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

  /// The source name only tells accounts apart when the same account name and plan appear on
  /// another source. With one source it adds nothing, and offline rows already say so.
  public static func needsSource(_ item: AccountItem, among items: [AccountItem]) -> Bool {
    items.contains {
      $0.snapshot.id != item.snapshot.id && $0.account.provider == item.account.provider
        && $0.account.name == item.account.name && $0.account.plan == item.account.plan
    }
  }

  /// Dashboard navigation always stays on the configured source. Feed URLs cannot redirect a
  /// token recovery to another host. Opening a browser never carries the API token.
  public static func dashboard(_ source: Source) -> URL { source.baseURL }
}
