import Foundation
import Testing

@testable import HeadroomKit

@Test func widgetLocationUsesTheExtensionContainer() {
  let location = WidgetCacheLocation(homeDirectory: URL(filePath: "/synthetic-home"))
  #expect(
    location.url.path
      == "/synthetic-home/Library/Containers/club.theblank.headroom.mac.widgets/Data/Library/Application Support/Headroom/widget-cache.json"
  )
  #expect(WidgetCacheLocation.ownContainer.url.lastPathComponent == "widget-cache.json")
}

@Test func widgetCacheMergesSourcesAndContainsOnlyFormattedRows() throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let writer = WidgetCacheWriter(
    location: WidgetCacheLocation(url: directory.appending(path: "widget-cache.json")))
  #expect(try writer.read() == nil)
  let feed = try fixture()
  let now = try #require(Formatting.date(milliseconds: feed.generatedAt))
  let a = try source()
  let b = try source()
  try writer.write(
    sources: [
      SourceSnapshot(
        source: a, state: .connected, cached: CachedFeed(feed: feed, etag: "one", readAt: now)),
      SourceSnapshot(
        source: b, state: .offline, cached: CachedFeed(feed: feed, etag: "two", readAt: now)),
      SourceSnapshot(source: source()),
    ], now: now)
  let cache = try #require(try writer.read())
  #expect(cache.rows.count == feed.accounts.count * 2)
  #expect(Set(cache.rows.map(\.id)).count == cache.rows.count)
  #expect(cache.rows.filter { $0.state == .offline }.count == feed.accounts.count)
  #expect(cache.rows.flatMap(\.limits).contains { $0.left == "Unknown" })
  #expect(cache.rows.flatMap(\.limits).contains { $0.left == "0% left" })
  #expect(
    cache.rows.flatMap(\.limits).compactMap(\.runOut).allSatisfy {
      $0.hasSuffix("if the pace holds")
    })
  let serialized = try String(contentsOf: writer.location.url, encoding: .utf8)
  for excluded in [
    "token", "Authorization", "baseURL", "identity", "@example.invalid", "dashboardUrl", "notices",
  ] {
    #expect(!serialized.contains(excluded))
  }
  try writer.write(sources: [], now: now)
  #expect(try writer.read()?.rows.isEmpty == true)
}
