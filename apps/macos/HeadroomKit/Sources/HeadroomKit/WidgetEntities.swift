import Foundation

/// An account or limit the widget editor offers. The App Intents entity types live in the
/// widget extension: App Intents registers only entities declared in the target itself, and a
/// package-declared entity left every saved choice unresolved.
public struct WidgetChoice: Equatable, Sendable {
  public let id: String
  public let title: String
  /// For a limit, the account it belongs to and its key.
  public var accountID: String? = nil
  public var key: String? = nil
}

public enum WidgetChoices {
  public static func accounts(in cache: WidgetCache?) -> [WidgetChoice] {
    let rows = cache?.rows ?? []
    return rows.map { row in
      let duplicate = rows.contains {
        $0.id != row.id && $0.provider == row.provider && $0.name == row.name
      }
      let title =
        "\(Presentation.providerName(row.provider)) \(row.name)"
        + (duplicate ? " · \(row.sourceName)" : "")
      return WidgetChoice(id: row.id, title: title)
    }
  }

  public static func limits(in cache: WidgetCache?, accountID: String? = nil) -> [WidgetChoice] {
    let accounts = Self.accounts(in: cache)
    return (cache?.rows ?? []).filter { accountID == nil || $0.id == accountID }.flatMap { row in
      row.limits.map { limit in
        WidgetChoice(
          id: "\(row.id)/\(limit.key)",
          title: accountID == nil
            ? "\(accounts.first { $0.id == row.id }?.title ?? row.name) · \(limit.label)"
            : limit.label,
          accountID: row.id, key: limit.key)
      }
    }
  }

  /// The saved identifiers that still exist, in their saved order.
  public static func pick(_ identifiers: [String], from choices: [WidgetChoice]) -> [WidgetChoice] {
    identifiers.compactMap { id in choices.first { $0.id == id } }
  }
}
