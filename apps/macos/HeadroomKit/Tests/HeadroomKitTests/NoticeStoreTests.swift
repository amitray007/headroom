import Foundation
import Testing

@testable import HeadroomKit

@Test func noticeLifecyclePersistsReadUnreadAndBannerHistory() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let id = UUID()
  let now = Date(timeIntervalSince1970: 42)
  let notice = try #require(fixture().notices.first)
  try await store.ingest(sourceID: id, notices: [notice], now: now)
  #expect(await store.bannerIDs(sourceID: id).isEmpty)
  #expect(await store.records(sourceID: id)[notice.id]?.read == false)
  var next = notice
  next.id = "synthetic-next-period"
  try await store.ingest(sourceID: id, notices: [notice, next], now: now.addingTimeInterval(10))
  #expect(await store.bannerIDs(sourceID: id) == [next.id])
  try await store.setRead(true, id: next.id, sourceID: id)
  #expect(await store.bannerIDs(sourceID: id).isEmpty)
  try await store.setRead(false, id: next.id, sourceID: id)
  #expect(await store.bannerIDs(sourceID: id) == [next.id])
  try await store.markBannered(id: next.id, sourceID: id)
  #expect(await store.bannerIDs(sourceID: id).isEmpty)
  let reloaded = try NoticeStore(directory: directory)
  #expect(await reloaded.records(sourceID: id)[next.id]?.bannered == true)
  #expect(await reloaded.records(sourceID: id)[notice.id]?.firstSeen == now)
  try await reloaded.markAllRead()
  #expect(await reloaded.records(sourceID: id).values.allSatisfy(\.read))
}

@Test func noticeEvictionNeedsTwoConsecutiveMissingFeedsAndIsSourceScoped() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let a = UUID()
  let b = UUID()
  let now = Date()
  let notice = try #require(fixture().notices.first)
  try await store.ingest(sourceID: a, notices: [notice], now: now)
  try await store.ingest(sourceID: b, notices: [notice], now: now)
  try await store.ingest(sourceID: a, notices: [], now: now)
  #expect(await store.records(sourceID: a)[notice.id]?.missingFeeds == 1)
  try await store.ingest(sourceID: a, notices: [notice], now: now)
  #expect(await store.records(sourceID: a)[notice.id]?.missingFeeds == 0)
  try await store.ingest(sourceID: a, notices: [], now: now)
  try await store.ingest(sourceID: a, notices: [], now: now)
  #expect(await store.records(sourceID: a).isEmpty)
  #expect(await store.records(sourceID: b).count == 1)
  try await store.remove(sourceID: b)
  #expect(await store.records(sourceID: b).isEmpty)
}

@Test func kindSwitchesPersistAndDoNotAffectOtherKinds() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let id = UUID()
  let notices = try fixture().notices
  let first = try #require(notices.first)
  let other = try #require(notices.first { $0.kind != first.kind })
  try await store.ingest(sourceID: id, notices: [], now: Date())
  try await store.setEnabled(false, kind: first.kind)
  try await store.ingest(sourceID: id, notices: [first, other], now: Date())
  #expect(await store.bannerIDs(sourceID: id) == [other.id])
  let reloaded = try NoticeStore(directory: directory)
  #expect(await reloaded.bannerIDs(sourceID: id) == [other.id])
  try await reloaded.setEnabled(true, kind: first.kind)
  #expect(await reloaded.bannerIDs(sourceID: id) == [first.id, other.id])
}

@Test(arguments: NoticeKind.allCases)
func everyNoticeKindHasAnIndependentSwitch(_ kind: NoticeKind) async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let sourceID = UUID()
  var notice = try #require(fixture().notices.first)
  notice.kind = kind
  try await store.ingest(sourceID: sourceID, notices: [], now: Date())
  try await store.ingest(sourceID: sourceID, notices: [notice], now: Date())
  #expect(await store.bannerIDs(sourceID: sourceID) == [notice.id])
  try await store.setEnabled(false, kind: kind)
  #expect(await store.bannerIDs(sourceID: sourceID).isEmpty)
}

@Test func bannerHistorySurvivesEvictionRestartAndRepeatedDisconnectIDs() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let sourceID = UUID()
  var notice = try #require(fixture().notices.first)
  let now = Date()
  try await store.ingest(sourceID: sourceID, notices: [notice], now: now)
  try await store.ingest(sourceID: sourceID, notices: [], now: now)
  try await store.ingest(sourceID: sourceID, notices: [], now: now)
  try await store.ingest(sourceID: sourceID, notices: [notice], now: now)
  #expect(await store.bannerIDs(sourceID: sourceID).isEmpty)
  notice.id = "new-period"
  try await store.ingest(sourceID: sourceID, notices: [notice], now: now)
  #expect(try await store.claimBanner(id: notice.id, sourceID: sourceID))
  #expect(try await !store.claimBanner(id: notice.id, sourceID: sourceID))
  try await store.ingest(sourceID: sourceID, notices: [], now: now)
  try await store.ingest(sourceID: sourceID, notices: [], now: now)
  let reloaded = try NoticeStore(directory: directory)
  try await reloaded.ingest(sourceID: sourceID, notices: [notice], now: now)
  #expect(await reloaded.bannerIDs(sourceID: sourceID).isEmpty)
  notice.kind = .disconnected
  notice.id = "disconnected-first"
  try await reloaded.ingest(sourceID: sourceID, notices: [notice], now: now)
  #expect(try await reloaded.claimBanner(id: notice.id, sourceID: sourceID))
  notice.id = "disconnected-different-last-success"
  try await reloaded.ingest(sourceID: sourceID, notices: [notice], now: now)
  #expect(await reloaded.bannerIDs(sourceID: sourceID).isEmpty)
}

@Test func sourceSignOutBannersOnceAndKeepsAnUnreadListEntry() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let sourceID = UUID()
  let id = NoticeStore.sourceSignOutID
  try await store.updateSourceState(sourceID: sourceID, signedOut: false, now: Date())
  #expect(await store.bannerIDs(sourceID: sourceID).isEmpty)
  try await store.updateSourceState(sourceID: sourceID, signedOut: true, now: Date())
  #expect(await store.bannerIDs(sourceID: sourceID) == [id])
  try await store.setEnabled(false, kind: .disconnected)
  #expect(try await !store.claimBanner(id: id, sourceID: sourceID))
  try await store.setEnabled(true, kind: .disconnected)
  #expect(try await store.claimBanner(id: id, sourceID: sourceID))
  try await store.updateSourceState(sourceID: sourceID, signedOut: false, now: Date())
  #expect(await store.records(sourceID: sourceID).isEmpty)
  let reloaded = try NoticeStore(directory: directory)
  try await reloaded.updateSourceState(sourceID: sourceID, signedOut: true, now: Date())
  #expect(await reloaded.bannerIDs(sourceID: sourceID).isEmpty)
  #expect(await reloaded.records(sourceID: sourceID)[id]?.read == false)
  try await reloaded.markAllRead()
  #expect(await reloaded.records(sourceID: sourceID)[id]?.read == true)
  try await reloaded.remove(sourceID: sourceID)
  #expect(await reloaded.records(sourceID: sourceID).isEmpty)
}

@Test(arguments: [false, true]) func bannerToneAndThreadMapping(timeSensitiveAllowed: Bool) {
  #expect(
    BannerTone.level(.bad, timeSensitiveAllowed: timeSensitiveAllowed)
      == (timeSensitiveAllowed ? .timeSensitive : .active))
  #expect(BannerTone.level(.warn, timeSensitiveAllowed: timeSensitiveAllowed) == .active)
  #expect(BannerTone.level(.info, timeSensitiveAllowed: timeSensitiveAllowed) == .passive)
  let sourceID = UUID()
  #expect(
    BannerTone.thread(sourceID: sourceID, accountID: "a")
      != BannerTone.thread(sourceID: UUID(), accountID: "a"))
  #expect(
    BannerTone.thread(sourceID: sourceID, accountID: "a")
      != BannerTone.thread(sourceID: sourceID, accountID: "b"))
}

@Test func concurrentBannerClaimsAndReadChangesCannotSubmitTheSameIDTwice() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  let sourceID = UUID()
  let notice = try #require(fixture().notices.first)
  try await store.ingest(sourceID: sourceID, notices: [], now: Date())
  try await store.ingest(sourceID: sourceID, notices: [notice], now: Date())
  try await store.setRead(true, id: notice.id, sourceID: sourceID)
  #expect(try await !store.claimBanner(id: notice.id, sourceID: sourceID))
  try await store.setRead(false, id: notice.id, sourceID: sourceID)
  let claims = try await withThrowingTaskGroup(of: Bool.self) { group in
    for _ in 0..<4 {
      group.addTask { try await store.claimBanner(id: notice.id, sourceID: sourceID) }
    }
    var values: [Bool] = []
    for try await value in group { values.append(value) }
    return values
  }
  #expect(claims.filter { $0 }.count == 1)
}

@Test(arguments: NoticeKind.allCases) func nativeNoticeMappingKeepsKindsAndUsesWebRecovery(
  _ kind: NoticeKind
) throws {
  var notice = try #require(fixture().notices.first)
  notice.kind = kind
  let value = NativeNotice(notice, sourceName: "Work server")
  let restored = try JSONDecoder().decode(NativeNotice.self, from: JSONEncoder().encode(value))
  #expect(restored.id == notice.id)
  #expect(restored.message == value.message)
  #expect(restored.kind == kind)
  #expect(value.id == notice.id)
  #expect(value.kind == kind)
  #expect(value.accountID == notice.connection.id)
  #expect(restored.provider == notice.provider.rawValue)
  #expect(value.title == notice.title)
  if kind == .disconnected || kind == .refresh_failed {
    #expect(value.message.contains("Work server"))
    #expect(
      value.message.contains("web dashboard") || value.message.contains("connection and refresh"))
  } else if kind == .auto_reset {
    #expect(value.message.hasPrefix("The owner's rule on Work server:"))
  } else {
    #expect(value.message == notice.message)
  }
}
