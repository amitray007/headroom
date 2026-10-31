import Foundation

public struct NoticeRecord: Codable, Sendable {
  public let firstSeen: Date
  public var read: Bool
  public var bannered: Bool
  public let kind: NoticeKind
  public var missingFeeds: Int
  var eligibleForBanner: Bool
}

public actor NoticeStore {
  private struct State: Codable {
    var sources: [UUID: [String: NoticeRecord]] = [:]
    var kinds: [String: Bool] = [:]
  }
  private let file: URL
  private var state: State

  public init(directory: URL = HeadroomStorage.directory) throws {
    file = directory.appending(path: "notices.json")
    state = try HeadroomStorage.read(State.self, at: file) ?? State()
  }

  public func ingest(sourceID: UUID, notices: [FeedNotice], now: Date) throws {
    let hasReadSource = state.sources[sourceID] != nil
    var entries = state.sources[sourceID] ?? [:]
    let present = Set(notices.map(\.id))
    for id in Array(entries.keys) where !present.contains(id) {
      entries[id]?.missingFeeds += 1
      if (entries[id]?.missingFeeds ?? 0) >= 2 { entries[id] = nil }
    }
    for notice in notices {
      if entries[notice.id] != nil {
        entries[notice.id]?.missingFeeds = 0
      } else {
        entries[notice.id] = NoticeRecord(
          firstSeen: now, read: false, bannered: false, kind: notice.kind,
          missingFeeds: 0, eligibleForBanner: hasReadSource
        )
      }
    }
    state.sources[sourceID] = entries
    try persist()
  }

  public func records(sourceID: UUID) -> [String: NoticeRecord] { state.sources[sourceID] ?? [:] }

  public func bannerIDs(sourceID: UUID) -> Set<String> {
    Set(
      (state.sources[sourceID] ?? [:]).filter { _, value in
        value.missingFeeds == 0 && !value.read && !value.bannered && value.eligibleForBanner
          && state.kinds[value.kind.rawValue] != false
      }.keys)
  }

  public func setRead(_ read: Bool, id: String, sourceID: UUID) throws {
    state.sources[sourceID]?[id]?.read = read
    try persist()
  }

  public func markAllRead() throws {
    for source in Array(state.sources.keys) {
      for id in Array(state.sources[source]?.keys ?? [String: NoticeRecord]().keys) {
        state.sources[source]?[id]?.read = true
      }
    }
    try persist()
  }

  public func markBannered(id: String, sourceID: UUID) throws {
    state.sources[sourceID]?[id]?.bannered = true
    try persist()
  }

  public func setEnabled(_ enabled: Bool, kind: NoticeKind) throws {
    state.kinds[kind.rawValue] = enabled
    try persist()
  }

  public func remove(sourceID: UUID) throws {
    state.sources[sourceID] = nil
    try persist()
  }

  private func persist() throws { try HeadroomStorage.write(state, to: file) }
}
