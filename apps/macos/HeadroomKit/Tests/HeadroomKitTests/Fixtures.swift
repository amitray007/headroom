import Foundation
import HeadroomKit
import Testing

func fixture(_ name: String = "demo") throws -> AppFeed {
  let url = try #require(
    Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
  return try JSONDecoder().decode(AppFeed.self, from: Data(contentsOf: url))
}

func temporaryDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory.appending(path: "headroom-test-\(UUID())")
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

func source(_ host: String = "https://headroom.example.invalid") throws -> Source {
  try Source(name: "Synthetic source", baseURL: #require(URL(string: host)))
}
