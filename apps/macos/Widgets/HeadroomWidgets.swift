import HeadroomKit
import SwiftUI
import WidgetKit

struct CacheEntry: TimelineEntry {
  let date: Date
  let cache: WidgetCache?
}

struct CacheProvider: TimelineProvider {
  func placeholder(in context: Context) -> CacheEntry { CacheEntry(date: Date(), cache: nil) }
  func getSnapshot(in context: Context, completion: @escaping (CacheEntry) -> Void) {
    completion(read())
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<CacheEntry>) -> Void) {
    let entry = read()
    completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(120))))
  }
  private func read() -> CacheEntry {
    let cache = try? WidgetCacheWriter(location: .ownContainer).read()
    return CacheEntry(date: Date(), cache: cache)
  }
}

struct CacheView: View {
  let entry: CacheEntry
  var body: some View {
    VStack(alignment: .leading) {
      Text("Headroom").font(.headline)
      if let row = entry.cache?.rows.first {
        Text(row.name)
        Text(row.status).font(.caption)
        Text(row.state.rawValue).font(.caption).foregroundStyle(.secondary)
      } else {
        Text("Open Headroom to load accounts.").font(.caption)
      }
    }
    .containerBackground(.background, for: .widget)
  }
}

@main
struct HeadroomWidgets: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Headroom", provider: CacheProvider()) { entry in
      CacheView(entry: entry)
    }
    .configurationDisplayName("Headroom")
    .description("Account readings from your Headroom sources.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
