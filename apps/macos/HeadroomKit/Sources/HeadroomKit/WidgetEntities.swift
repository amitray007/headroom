import AppIntents
import Foundation

public struct WidgetAccountEntity: AppEntity, Sendable {
  public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Account"
  public static let defaultQuery = WidgetAccountQuery()
  public let id: String
  public let title: String
  public var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(title)")
  }

  public static func entities(in cache: WidgetCache?) -> [Self] {
    let rows = cache?.rows ?? []
    return rows.map { row in
      let duplicate = rows.contains {
        $0.id != row.id && $0.provider == row.provider && $0.name == row.name
      }
      let title =
        "\(Presentation.providerName(row.provider)) \(row.name)"
        + (duplicate ? " · \(row.sourceName)" : "")
      return Self(id: row.id, title: title)
    }
  }
}

public struct WidgetAccountQuery: EntityQuery {
  public let location: WidgetCacheLocation
  public init() { location = .ownContainer }
  public init(location: WidgetCacheLocation) { self.location = location }
  public func entities(for identifiers: [String]) async throws -> [WidgetAccountEntity] {
    let entities = try await suggestedEntities()
    return identifiers.compactMap { id in entities.first { $0.id == id } }
  }
  public func suggestedEntities() async throws -> [WidgetAccountEntity] {
    WidgetAccountEntity.entities(in: try WidgetCacheReader(location: location).read())
  }
  public func defaultResult() async -> WidgetAccountEntity? { try? await suggestedEntities().first }
}

public struct WidgetLimitEntity: AppEntity, Sendable {
  public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Limit"
  public static let defaultQuery = WidgetLimitQuery()
  public let id: String
  public let accountID: String
  public let key: String
  public let title: String
  public var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(title)")
  }

  public static func entities(in cache: WidgetCache?, accountID: String? = nil) -> [Self] {
    let accounts = WidgetAccountEntity.entities(in: cache)
    return (cache?.rows ?? []).filter { accountID == nil || $0.id == accountID }.flatMap { row in
      row.limits.map { limit in
        Self(
          id: "\(row.id)/\(limit.key)", accountID: row.id, key: limit.key,
          title: accountID == nil
            ? "\(accounts.first { $0.id == row.id }?.title ?? row.name) · \(limit.label)"
            : limit.label)
      }
    }
  }
}

public struct WidgetLimitQuery: EntityQuery {
  public let location: WidgetCacheLocation
  public init() { location = .ownContainer }
  public init(location: WidgetCacheLocation) { self.location = location }
  public func entities(for identifiers: [String]) async throws -> [WidgetLimitEntity] {
    let entities = try await suggestedEntities()
    return identifiers.compactMap { id in entities.first { $0.id == id } }
  }
  public func suggestedEntities() async throws -> [WidgetLimitEntity] {
    WidgetLimitEntity.entities(in: try WidgetCacheReader(location: location).read())
  }
}
