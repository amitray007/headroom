import Foundation

public struct NoticeRecord: Codable, Sendable {
  public let firstSeen: Date
  public var read: Bool
  public var bannered: Bool
  public let kind: NoticeKind
  public var missingFeeds: Int
  var eligibleForBanner: Bool
  var accountID: String?
}

public actor NoticeStore {
  private struct State: Codable {
    var sources: [UUID: [String: NoticeRecord]] = [:]
    var kinds: [String: Bool] = [:]
    var bannerHistory: [UUID: Set<String>]?
    var disconnectedAccounts: [UUID: Set<String>]?
    var sourceSignOut: [UUID: NoticeRecord]?
    /// Read marks made on this Mac that the server has not saved yet, by source and notice.
    /// `nil` in a file from before read sync (D45).
    var pendingReads: [UUID: [String: Bool]]?
  }
  private let file: URL
  private var state: State

  public init(directory: URL = HeadroomStorage.directory) throws {
    file = directory.appending(path: "notices.json")
    state = try HeadroomStorage.read(State.self, at: file) ?? State()
    if state.pendingReads == nil {
      // Notices read on this Mac before read sync go to the server once, so they stay read.
      state.pendingReads = state.sources.mapValues { records in
        records.filter(\.value.read).mapValues { _ in true }
      }.filter { !$0.value.isEmpty }
    }
  }

  public func ingest(sourceID: UUID, notices: [FeedNotice], now: Date) throws {
    let hasReadSource = state.sources[sourceID] != nil
    var entries = state.sources[sourceID] ?? [:]
    let present = Set(notices.map(\.id))
    if !hasReadSource {
      if state.bannerHistory == nil { state.bannerHistory = [:] }
      state.bannerHistory?[sourceID, default: []].formUnion(present)
    }
    for id in Array(entries.keys) where !present.contains(id) {
      entries[id]?.missingFeeds += 1
      if (entries[id]?.missingFeeds ?? 0) >= 2 {
        entries[id] = nil
        state.pendingReads?[sourceID]?[id] = nil
      }
    }
    // The server's flag wins, except for a mark this Mac has not sent yet.
    let pending = state.pendingReads?[sourceID] ?? [:]
    for notice in notices {
      let read = pending[notice.id] ?? notice.read
      if entries[notice.id] != nil {
        entries[notice.id]?.missingFeeds = 0
        entries[notice.id]?.read = read
      } else {
        entries[notice.id] = NoticeRecord(
          firstSeen: now, read: read, bannered: false, kind: notice.kind,
          missingFeeds: 0,
          eligibleForBanner: hasReadSource
            && !(state.bannerHistory?[sourceID]?.contains(notice.id) ?? false),
          accountID: notice.connection.id
        )
      }
    }
    state.sources[sourceID] = entries
    try persist()
  }

  public static let sourceSignOutID = "headroom:source-signed-out"

  public func updateSourceState(sourceID: UUID, signedOut: Bool, now: Date) throws {
    if state.sourceSignOut?[sourceID] == nil, signedOut {
      if state.sourceSignOut == nil { state.sourceSignOut = [:] }
      state.sourceSignOut?[sourceID] = NoticeRecord(
        firstSeen: now, read: false, bannered: false,
        kind: .disconnected, missingFeeds: 0, eligibleForBanner: true)
    } else if state.sourceSignOut?[sourceID] != nil {
      state.sourceSignOut?[sourceID]?.missingFeeds = signedOut ? 0 : 1
    }
    try persist()
  }

  public func records(sourceID: UUID) -> [String: NoticeRecord] {
    var records = state.sources[sourceID] ?? [:]
    if let record = state.sourceSignOut?[sourceID], record.missingFeeds == 0 {
      records[Self.sourceSignOutID] = record
    }
    return records
  }

  public func bannerIDs(sourceID: UUID) -> Set<String> {
    Set(
      records(sourceID: sourceID).filter { _, value in
        value.missingFeeds == 0 && !value.read && !value.bannered && value.eligibleForBanner
          && state.kinds[value.kind.rawValue] != false
          && !(value.kind == .disconnected
            && value.accountID.map {
              state.disconnectedAccounts?[sourceID]?.contains($0) ?? false
            } == true)
      }.keys)
  }

  public func setRead(_ read: Bool, id: String, sourceID: UUID) throws {
    if id == Self.sourceSignOutID {
      state.sourceSignOut?[sourceID]?.read = read
    } else {
      state.sources[sourceID]?[id]?.read = read
      queue(read, ids: [id], sourceID: sourceID)
    }
    try persist()
  }

  public func markAllRead() throws {
    for source in Array(state.sourceSignOut?.keys ?? [:].keys) {
      state.sourceSignOut?[source]?.read = true
    }
    for source in Array(state.sources.keys) {
      let ids = Array(state.sources[source]?.keys ?? [String: NoticeRecord]().keys)
      for id in ids { state.sources[source]?[id]?.read = true }
      queue(true, ids: ids, sourceID: source)
    }
    try persist()
  }

  /// Marks waiting for the server, by notice id.
  public func pendingReads(sourceID: UUID) -> [String: Bool] {
    state.pendingReads?[sourceID] ?? [:]
  }

  /// Drops the marks the server saved. A mark changed again since it was sent stays queued.
  public func confirmReads(_ sent: [String: Bool], sourceID: UUID) throws {
    for (id, read) in sent where state.pendingReads?[sourceID]?[id] == read {
      state.pendingReads?[sourceID]?[id] = nil
    }
    if state.pendingReads?[sourceID]?.isEmpty == true { state.pendingReads?[sourceID] = nil }
    try persist()
  }

  private func queue(_ read: Bool, ids: [String], sourceID: UUID) {
    guard !ids.isEmpty else { return }
    if state.pendingReads == nil { state.pendingReads = [:] }
    for id in ids { state.pendingReads?[sourceID, default: [:]][id] = read }
  }

  public func claimBanner(id: String, sourceID: UUID) throws -> Bool {
    guard bannerIDs(sourceID: sourceID).contains(id) else { return false }
    try markBannered(id: id, sourceID: sourceID)
    return true
  }

  public func markBannered(id: String, sourceID: UUID) throws {
    if id == Self.sourceSignOutID {
      state.sourceSignOut?[sourceID]?.bannered = true
    } else {
      state.sources[sourceID]?[id]?.bannered = true
    }
    if state.bannerHistory == nil { state.bannerHistory = [:] }
    state.bannerHistory?[sourceID, default: []].insert(id)
    if let record = state.sources[sourceID]?[id], record.kind == .disconnected,
      let account = record.accountID
    {
      if state.disconnectedAccounts == nil { state.disconnectedAccounts = [:] }
      state.disconnectedAccounts?[sourceID, default: []].insert(account)
    }
    try persist()
  }

  public func enabledKinds() -> [String: Bool] { state.kinds }

  public func setEnabled(_ enabled: Bool, kind: NoticeKind) throws {
    state.kinds[kind.rawValue] = enabled
    try persist()
  }

  public func remove(sourceID: UUID) throws {
    state.sources[sourceID] = nil
    state.sourceSignOut?[sourceID] = nil
    state.bannerHistory?[sourceID] = nil
    state.disconnectedAccounts?[sourceID] = nil
    state.pendingReads?[sourceID] = nil
    try persist()
  }

  private func persist() throws { try HeadroomStorage.write(state, to: file) }
}
