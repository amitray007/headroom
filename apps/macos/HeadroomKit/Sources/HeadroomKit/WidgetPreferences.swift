import Foundation

/// What the widgets show, chosen in the app's Widgets settings and carried to the extension in
/// the widget cache. An ad-hoc signed extension cannot resolve App Intents parameters, so the
/// widgets use static configurations and read these instead.
public struct WidgetPreferences: Codable, Equatable, Sendable {
  public static let maxAccounts = 3
  /// The Account widget's account, a widget row ID; nil shows the first account.
  public var accountID: String?
  /// The Account widget's limit key; nil picks the limits automatically.
  public var limitKey: String?
  /// The Account widget shows the share used instead of the room left.
  public var used = false
  /// The Accounts widget's chosen accounts, in order. Accounts that need attention first fill
  /// the rest of its three rows.
  public var accountIDs: [String] = [] {
    didSet {
      if accountIDs.count > Self.maxAccounts {
        accountIDs = Array(accountIDs.prefix(Self.maxAccounts))
      }
    }
  }

  public init(
    accountID: String? = nil, limitKey: String? = nil, used: Bool = false,
    accountIDs: [String] = []
  ) {
    self.accountID = accountID
    self.limitKey = limitKey
    self.used = used
    self.accountIDs = Array(accountIDs.prefix(Self.maxAccounts))
  }

  // Settings saved before a field existed still load, with that field at its default.
  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    accountID = try values.decodeIfPresent(String.self, forKey: .accountID)
    limitKey = try values.decodeIfPresent(String.self, forKey: .limitKey)
    used = try values.decodeIfPresent(Bool.self, forKey: .used) ?? false
    accountIDs = Array(
      (try values.decodeIfPresent([String].self, forKey: .accountIDs) ?? []).prefix(
        Self.maxAccounts))
  }

  /// The Accounts widget's rows at a timeline date: the chosen accounts that still exist, in
  /// order, then the accounts that need attention first.
  public func accounts(in rows: [WidgetAccountRow], at date: Date) -> [String] {
    let chosen = accountIDs.filter { id in rows.contains { $0.id == id } }
    let rest = WidgetLedger.tightest(rows.filter { !chosen.contains($0.id) }, at: date)
    return chosen + rest.prefix(Self.maxAccounts - chosen.count).map(\.id)
  }
}
