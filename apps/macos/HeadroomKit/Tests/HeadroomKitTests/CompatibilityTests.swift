import Foundation
import Testing

@testable import HeadroomKit

/// A synthetic feed as the oldest supported server sends it, frozen when that server shipped.
/// Replace it only when `ServerCompatibility.minimumServer` is raised, with a feed from that
/// release; regenerating it from today's server would hide a broken older one.
@Test func theOldestSupportedServersFeedStillReads() async throws {
  let url = try #require(
    Bundle.module.url(
      forResource: ServerCompatibility.minimumServer, withExtension: "json",
      subdirectory: "Fixtures/Servers"),
    "Add Fixtures/Servers/\(ServerCompatibility.minimumServer).json for the new minimum")
  let feed = try JSONDecoder().decode(AppFeed.self, from: Data(contentsOf: url))
  #expect(feed.apiVersion == 1)
  #expect(!feed.accounts.isEmpty)
}

@Test(arguments: [
  (DecodingError.keyNotFound(
    AnyKey("read"), .init(codingPath: [AnyKey("notices")], debugDescription: "")),
    SourceState.needsUpdate),
  (DecodingError.dataCorrupted(.init(codingPath: [AnyKey("kind")], debugDescription: "")),
    .appOutdated),
  (DecodingError.typeMismatch(Int.self, .init(codingPath: [AnyKey("x")], debugDescription: "")),
    .appOutdated),
])
func aDecodeFailureNamesTheSideToUpdate(_ error: DecodingError, _ side: SourceState) {
  #expect(ServerCompatibility.side(of: error) == side)
}

private struct AnyKey: CodingKey {
  var stringValue: String
  var intValue: Int? { nil }
  init(_ value: String) { stringValue = value }
  init?(stringValue: String) { self.stringValue = stringValue }
  init?(intValue: Int) { nil }
}
