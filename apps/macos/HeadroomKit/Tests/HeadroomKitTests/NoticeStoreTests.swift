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
