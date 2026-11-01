import AppIntents
import HeadroomKit

// Declared in the extension target so App Intents registers them; see WidgetChoices.

struct WidgetAccountEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Account"
  static let defaultQuery = WidgetAccountQuery()
  let id: String
  let title: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

  init(_ choice: WidgetChoice) {
    id = choice.id
    title = choice.title
  }
}

struct WidgetAccountQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [WidgetAccountEntity] {
    WidgetChoices.pick(identifiers, from: WidgetChoices.accounts(in: try WidgetCacheReader().read()))
      .map(WidgetAccountEntity.init)
  }
  func suggestedEntities() async throws -> [WidgetAccountEntity] {
    WidgetChoices.accounts(in: try WidgetCacheReader().read()).map(WidgetAccountEntity.init)
  }
  func defaultResult() async -> WidgetAccountEntity? { try? await suggestedEntities().first }
}

struct WidgetLimitEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Limit"
  static let defaultQuery = WidgetLimitQuery()
  let id: String
  let accountID: String
  let key: String
  let title: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

  init(_ choice: WidgetChoice) {
    id = choice.id
    accountID = choice.accountID ?? ""
    key = choice.key ?? ""
    title = choice.title
  }
}

struct WidgetLimitQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [WidgetLimitEntity] {
    WidgetChoices.pick(identifiers, from: WidgetChoices.limits(in: try WidgetCacheReader().read()))
      .map(WidgetLimitEntity.init)
  }
  func suggestedEntities() async throws -> [WidgetLimitEntity] {
    WidgetChoices.limits(in: try WidgetCacheReader().read()).map(WidgetLimitEntity.init)
  }
}
