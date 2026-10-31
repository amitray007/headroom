import Foundation
import Testing

@testable import HeadroomKit

@Test(arguments: [
  "http://127.0.0.1:8080", "http://localhost", "http://10.1.2.3", "http://172.16.0.1",
  "http://172.31.255.255", "http://192.168.1.2", "http://[::1]", "http://[fd12::1]",
  "http://[::ffff:127.0.0.1]", "https://example.invalid",
])
func acceptedSources(_ value: String) throws { _ = try source(value) }

@Test(arguments: [
  "http://example.invalid", "http://192.168.1.2.example.invalid", "http://172.32.0.1",
  "http://8.8.8.8", "http://[2001:4860:4860::8888]", "http://[::ffff:8.8.8.8]", "ftp://localhost",
  "https://token@example.invalid", "https://example.invalid?token=secret",
  "https://example.invalid#secret",
])
func refusedSources(_ value: String) {
  #expect(throws: (any Error).self) { try source(value) }
}

@Test func sourceStorePersistsAndSeparatesIdentities() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = SourceStore(directory: directory)
  #expect(try await store.load().isEmpty)
  let first = try source()
  let second = try source()
  #expect(first.id != second.id)
  try await store.save([first, second])
  #expect(try await SourceStore(directory: directory).load() == [first, second])
  await #expect(throws: SourceError.duplicateID) { try await store.save([first, first]) }
  #expect(try await store.load().count == 2)
  let data = try Data(contentsOf: directory.appending(path: "sources.json"))
  #expect(!String(decoding: data, as: UTF8.self).contains("token"))
}

@Test func sourceDecodingEnforcesTheURLBoundary() throws {
  let data = Data(
    "{\"id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Synthetic\",\"baseURL\":\"http://8.8.8.8\"}"
      .utf8)
  #expect(throws: SourceError.insecureURL) { try JSONDecoder().decode(Source.self, from: data) }
}

@Test func vaultKeepsTokensSeparateAndRemovesOnlyOne() async throws {
  let vault: any TokenVault = InMemoryTokenVault()
  let a = UUID()
  let b = UUID()
  #expect(try await vault.token(for: a) == nil)
  try await vault.setToken("synthetic-a", for: a)
  try await vault.setToken("synthetic-b", for: b)
  try await vault.setToken(nil, for: a)
  #expect(try await vault.token(for: a) == nil)
  #expect(try await vault.token(for: b) == "synthetic-b")
  #expect(KeychainTokenVault.service == "club.theblank.headroom.mac")
}

@Test func feedCacheRoundTripsETagAndNullableMetricsPerSource() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let cache = FeedCache(directory: directory)
  let id = UUID()
  #expect(try await cache.load(sourceID: id) == nil)
  let feed = try fixture()
  try await cache.save(
    CachedFeed(feed: feed, etag: "\"synthetic\"", readAt: Date(timeIntervalSince1970: 42)),
    sourceID: id)
  let saved = try #require(try await FeedCache(directory: directory).load(sourceID: id))
  #expect(saved.feed == feed)
  #expect(saved.etag == "\"synthetic\"")
  #expect(saved.readAt == Date(timeIntervalSince1970: 42))
  #expect(try await cache.load(sourceID: UUID()) == nil)
  #expect(
    FileManager.default.fileExists(
      atPath: directory.appending(path: "feed-\(id.uuidString).json").path))
  try await cache.remove(sourceID: id)
  #expect(try await cache.load(sourceID: id) == nil)
}

@Test func malformedCacheIsReported() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let id = UUID()
  try Data("not JSON".utf8).write(to: directory.appending(path: "feed-\(id.uuidString).json"))
  await #expect(throws: (any Error).self) {
    try await FeedCache(directory: directory).load(sourceID: id)
  }
}

@Test func generatedFixturesKeepUnknownSeparateFromZero() throws {
  let feed = try fixture()
  #expect(feed.accounts.contains { $0.limits.contains { $0.percentLeft == nil } })
  #expect(feed.accounts.contains { $0.limits.contains { $0.percentLeft == 0 } })
  #expect(try fixture("empty").accounts.isEmpty)
}

@Test func sourcesNormalizeTrailingSlashesForTheGeneratedClient() throws {
  #expect(
    try source("https://example.invalid/").baseURL.absoluteString == "https://example.invalid")
  #expect(try source("https://example.invalid/headroom/").baseURL.path == "/headroom")
}

@Test func plainHTTPIsLimitedToLocalAndTailnetHosts() throws {
  for allowed in [
    "http://127.0.0.1:8080", "http://localhost:8080", "http://192.168.1.20:8080",
    "http://10.0.0.5", "http://172.16.0.1", "http://100.64.0.1:8080", "http://100.127.255.254",
    "http://mac-mini.local:8080", "http://[fd7a:115c:a1e0::1]:8080",
  ] {
    #expect(throws: Never.self) { try Source.validate(URL(string: allowed)!) }
  }
  for refused in [
    "http://8.8.8.8", "http://100.63.255.255", "http://100.128.0.1", "http://example.com",
    "http://headroom.example.ts.net",
  ] {
    #expect(throws: SourceError.insecureURL) { try Source.validate(URL(string: refused)!) }
  }
  #expect(throws: Never.self) { try Source.validate(URL(string: "https://headroom.example.ts.net")!) }
}
