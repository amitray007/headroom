import HeadroomKit
import SwiftUI
import WidgetKit

// Static configurations: the app's Widgets settings choose what each widget shows and write
// it into the widget cache. An ad-hoc signed extension has no team ID, so App Intents
// parameters never resolved and every widget editor choice was lost.

struct CacheEntry: TimelineEntry {
  let date: Date
  let cache: WidgetCache?
  let kind: WidgetKind
  var loading = false
}

struct CacheProvider: TimelineProvider {
  /// The kind for each family; All accounts draws Extra large as the detail ledger.
  let kind: @Sendable (WidgetFamily) -> WidgetKind

  func placeholder(in context: Context) -> CacheEntry {
    CacheEntry(date: Date(), cache: nil, kind: kind(context.family), loading: true)
  }
  func getSnapshot(in context: Context, completion: @escaping (CacheEntry) -> Void) {
    completion(
      CacheEntry(date: Date(), cache: try? WidgetCacheReader().read(), kind: kind(context.family)))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<CacheEntry>) -> Void) {
    let cache = try? WidgetCacheReader().read()
    let now = Date()
    completion(
      Timeline(
        entries: WidgetTimeline.dates(cache: cache, now: now).map {
          CacheEntry(date: $0, cache: cache, kind: kind(context.family))
        }, policy: .after(now.addingTimeInterval(120))))
  }
}

struct CacheView: View {
  let entry: CacheEntry
  init(entry: CacheEntry) {
    HR.registerFonts()
    self.entry = entry
  }
  var body: some View {
    let selection = WidgetSelection(kind: entry.kind, cache: entry.cache, date: entry.date)
    HeadroomWidgetPresentation(
      cache: entry.cache, date: entry.date, kind: entry.kind,
      accountIDs: selection.accountIDs, limitKey: selection.limitKey, used: selection.used,
      loading: entry.loading
    )
    .containerBackground(HR.surface, for: .widget)
  }
}

@MainActor private func ledgerWidget(
  kind: String, name: String, description: String, families: [WidgetFamily],
  widgetKind: @escaping @Sendable (WidgetFamily) -> WidgetKind
) -> some WidgetConfiguration {
  StaticConfiguration(kind: kind, provider: CacheProvider(kind: widgetKind)) {
    CacheView(entry: $0)
  }
  .configurationDisplayName(name).description(description)
  .supportedFamilies(families).contentMarginsDisabled()
}

struct AccountWidget: Widget {
  var body: some WidgetConfiguration {
    // The original kind, so widgets placed before static configurations stay in place.
    ledgerWidget(
      kind: "Headroom", name: "Account",
      description: "One account's limits. Choose the account in Headroom's Widgets settings.",
      families: [.systemSmall]
    ) { _ in .account }
  }
}
struct OverallWidget: Widget {
  var body: some WidgetConfiguration {
    ledgerWidget(
      kind: "HeadroomOverall", name: "Overall",
      description: "Out and run-out counts over the accounts that need attention first.",
      families: [.systemSmall]
    ) { _ in .overall }
  }
}
struct AccountsWidget: Widget {
  var body: some WidgetConfiguration {
    ledgerWidget(
      kind: "HeadroomAccounts", name: "Accounts",
      description: "Three accounts. Choose them in Headroom's Widgets settings.",
      families: [.systemMedium]
    ) { _ in .accounts }
  }
}
struct AllAccountsWidget: Widget {
  var body: some WidgetConfiguration {
    ledgerWidget(
      kind: "HeadroomAllAccounts", name: "All accounts",
      description: "The accounts that need attention first. Extra large shows every limit.",
      families: [.systemLarge, .systemExtraLarge]
    ) { $0 == .systemExtraLarge ? .detail : .allAccounts }
  }
}

@main
struct HeadroomWidgets: WidgetBundle {
  var body: some Widget {
    AccountWidget()
    OverallWidget()
    AccountsWidget()
    AllAccountsWidget()
  }
}
