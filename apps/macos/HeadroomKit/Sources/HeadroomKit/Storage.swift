import Foundation

public enum HeadroomStorage {
  /// The bundle id, not "Headroom": a native Headroom server keeps its database and keys in
  /// `Application Support/Headroom`, and neither app may touch the other's files.
  public static var directory: URL {
    URL.applicationSupportDirectory.appending(
      path: "club.theblank.headroom.mac", directoryHint: .isDirectory)
  }

  static func read<Value: Decodable>(_ type: Value.Type, at url: URL) throws -> Value? {
    do { return try JSONDecoder().decode(type, from: Data(contentsOf: url)) } catch CocoaError
      .fileReadNoSuchFile
    { return nil }
  }

  static func write(_ value: some Encodable, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    try encoder.encode(value).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
  }
}

public actor SourceStore {
  private let file: URL

  public init(directory: URL = HeadroomStorage.directory) {
    file = directory.appending(path: "sources.json")
  }

  public func load() throws -> [Source] {
    let sources = try HeadroomStorage.read([Source].self, at: file) ?? []
    try validate(sources)
    return sources
  }

  public func save(_ sources: [Source]) throws {
    try validate(sources)
    try HeadroomStorage.write(sources, to: file)
  }

  private func validate(_ sources: [Source]) throws {
    guard Set(sources.map(\.id)).count == sources.count else { throw SourceError.duplicateID }
    for source in sources { try Source.validate(source.baseURL) }
  }
}

public struct CachedFeed: Codable, Sendable {
  public var feed: AppFeed
  public var etag: String?
  public var readAt: Date

  public init(feed: AppFeed, etag: String?, readAt: Date) {
    self.feed = feed
    self.etag = etag
    self.readAt = readAt
  }
}

public actor FeedCache {
  private let directory: URL

  public init(directory: URL = HeadroomStorage.directory) { self.directory = directory }

  public func load(sourceID: UUID) throws -> CachedFeed? {
    try HeadroomStorage.read(CachedFeed.self, at: file(sourceID))
  }

  public func save(_ entry: CachedFeed, sourceID: UUID) throws {
    try HeadroomStorage.write(entry, to: file(sourceID))
  }

  public func remove(sourceID: UUID) throws {
    let path = file(sourceID)
    if FileManager.default.fileExists(atPath: path.path) {
      try FileManager.default.removeItem(at: path)
    }
  }

  private func file(_ id: UUID) -> URL { directory.appending(path: "feed-\(id.uuidString).json") }
}
