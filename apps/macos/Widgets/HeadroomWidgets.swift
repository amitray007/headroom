import AppIntents
import HeadroomKit
import SwiftUI
import WidgetKit

enum SmallWidgetContent: String, AppEnum {
  case account, overall
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Content"
  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .account: "Account", .overall: "Overall",
  ]
}

enum WidgetMeasure: String, AppEnum {
  case left, used
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Percentage"
  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .left: "Left", .used: "Used",
  ]
}

struct AccountConfiguration: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Account or Overall"
  static let description = IntentDescription(
    "Choose one account and a limit, or show overall counts.")
  @Parameter(title: "Kind", default: .account) var content: SmallWidgetContent
  @Parameter(title: "Account") var account: WidgetAccountEntity?
  @Parameter(title: "Limit", description: "Leave empty for all limits.", query: AccountLimitQuery())
  var limit: WidgetLimitEntity?
  @Parameter(title: "Show percentage", default: .left) var measure: WidgetMeasure
  static var parameterSummary: some ParameterSummary {
    When(\.$content, .equalTo, SmallWidgetContent.account) {
      Summary {
        \.$content
        \.$account
        \.$limit
        \.$measure
      }
    } otherwise: {
      Summary { \.$content }
    }
  }
}

struct AccountLimitQuery: EntityQuery {
  @IntentParameterDependency<AccountConfiguration>(\.$account) var configuration
  func entities(for identifiers: [String]) async throws -> [WidgetLimitEntity] {
    try await WidgetLimitQuery().entities(for: identifiers)
  }
  func suggestedEntities() async throws -> [WidgetLimitEntity] {
    guard let account = configuration?.account else { return [] }
    return WidgetLimitEntity.entities(in: try WidgetCacheReader().read(), accountID: account.id)
  }
}

struct AccountsConfiguration: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Accounts"
  static let description = IntentDescription(
    "Choose up to three accounts in display order. Remove one to choose another.")
  // WidgetKit owns the selection and ordering controls. Its size boundary prevents a fourth choice.
  @Parameter(title: "Accounts · maximum 3", size: IntentCollectionSize(min: 1, max: 3))
  var accounts: [WidgetAccountEntity]?
  static var parameterSummary: some ParameterSummary { Summary { \.$accounts } }
}

struct AllAccountsConfiguration: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "All accounts"
  static let description = IntentDescription(
    "All accounts from your Headroom sources, in source order.")
}

struct CacheEntry: TimelineEntry {
  let date: Date
  let cache: WidgetCache?
  let kind: WidgetKind
  var accountIDs: [String] = []
  var limitKey: String?
  var used = false
}

struct AccountProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> CacheEntry {
    CacheEntry(date: Date(), cache: nil, kind: .account)
  }
  func snapshot(for configuration: AccountConfiguration, in context: Context) async -> CacheEntry {
    entry(configuration, cache: try? WidgetCacheReader().read(), date: Date())
  }
  func timeline(for configuration: AccountConfiguration, in context: Context) async -> Timeline<
    CacheEntry
  > {
    let cache = try? WidgetCacheReader().read()
    let now = Date()
    return Timeline(
      entries: WidgetTimeline.dates(cache: cache, now: now).map {
        entry(configuration, cache: cache, date: $0)
      }, policy: .after(now.addingTimeInterval(120)))
  }
  private func entry(_ configuration: AccountConfiguration, cache: WidgetCache?, date: Date)
    -> CacheEntry
  {
    CacheEntry(
      date: date, cache: cache, kind: configuration.content == .overall ? .overall : .account,
      accountIDs: configuration.account.map { [$0.id] } ?? [],
      limitKey: configuration.limit?.accountID == configuration.account?.id
        ? configuration.limit?.key : nil,
      used: configuration.measure == .used)
  }
}

struct AccountsProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> CacheEntry {
    CacheEntry(date: Date(), cache: nil, kind: .accounts)
  }
  func snapshot(for configuration: AccountsConfiguration, in context: Context) async -> CacheEntry {
    CacheEntry(
      date: Date(), cache: try? WidgetCacheReader().read(), kind: .accounts,
      accountIDs: (configuration.accounts ?? []).prefix(3).map(\.id))
  }
  func timeline(for configuration: AccountsConfiguration, in context: Context) async -> Timeline<
    CacheEntry
  > {
    let cache = try? WidgetCacheReader().read()
    let now = Date()
    return Timeline(
      entries: WidgetTimeline.dates(cache: cache, now: now).map {
        CacheEntry(
          date: $0, cache: cache, kind: .accounts,
          accountIDs: (configuration.accounts ?? []).prefix(3).map(\.id))
      }, policy: .after(now.addingTimeInterval(120)))
  }
}

struct AllAccountsProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> CacheEntry {
    CacheEntry(date: Date(), cache: nil, kind: .allAccounts)
  }
  func snapshot(for configuration: AllAccountsConfiguration, in context: Context) async
    -> CacheEntry
  {
    CacheEntry(
      date: Date(), cache: try? WidgetCacheReader().read(),
      kind: context.family == .systemExtraLarge ? .detail : .allAccounts)
  }
  func timeline(for configuration: AllAccountsConfiguration, in context: Context) async -> Timeline<
    CacheEntry
  > {
    let cache = try? WidgetCacheReader().read()
    let now = Date()
    return Timeline(
      entries: WidgetTimeline.dates(cache: cache, now: now).map {
        CacheEntry(
          date: $0, cache: cache, kind: context.family == .systemExtraLarge ? .detail : .allAccounts
        )
      }, policy: .after(now.addingTimeInterval(120)))
  }
}

struct CacheView: View {
  let entry: CacheEntry
  init(entry: CacheEntry) {
    HR.registerFonts()
    self.entry = entry
  }
  var body: some View {
    HeadroomWidgetPresentation(
      cache: entry.cache, date: entry.date, kind: entry.kind,
      accountIDs: entry.accountIDs, limitKey: entry.limitKey, used: entry.used
    )
    .containerBackground(HR.surface, for: .widget)

  }
}

struct AccountWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "Headroom", intent: AccountConfiguration.self, provider: AccountProvider()
    ) { CacheView(entry: $0) }
    .configurationDisplayName("Account or Overall").description(
      "One account's limits or overall counts."
    )
    .supportedFamilies([.systemSmall]).contentMarginsDisabled()
  }
}
struct AccountsWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "HeadroomAccounts", intent: AccountsConfiguration.self, provider: AccountsProvider()
    ) { CacheView(entry: $0) }
    .configurationDisplayName("Accounts").description("Up to three accounts, in your chosen order.")
    .supportedFamilies([.systemMedium]).contentMarginsDisabled()
  }
}
struct AllAccountsWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "HeadroomAllAccounts", intent: AllAccountsConfiguration.self,
      provider: AllAccountsProvider()
    ) { CacheView(entry: $0) }
    .configurationDisplayName("All accounts").description(
      "All accounts. Extra large includes secondary limits."
    )
    .supportedFamilies([.systemLarge, .systemExtraLarge]).contentMarginsDisabled()
  }
}

@main
struct HeadroomWidgets: WidgetBundle {
  var body: some Widget {
    AccountWidget()
    AccountsWidget()
    AllAccountsWidget()
  }
}
