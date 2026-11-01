import Foundation
import Testing

@testable import HeadroomKit

private actor ManualClock: PollClock {
  var time = Date(timeIntervalSince1970: 1_793_286_000)
  var pending: [UUID: (Date, CheckedContinuation<Void, any Error>)] = [:]
  var sleeps: [Duration] = []
  var listeners: [CheckedContinuation<Duration, Never>] = []
  func now() -> Date { time }
  func sleep(for duration: Duration) async throws {
    try Task.checkCancellation()
    let id = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let seconds =
          Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
        pending[id] = (time.addingTimeInterval(seconds), continuation)
        if !listeners.isEmpty {
          listeners.removeFirst().resume(returning: duration)
        } else {
          sleeps.append(duration)
        }
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }
  private func cancel(_ id: UUID) {
    pending.removeValue(forKey: id)?.1.resume(throwing: CancellationError())
  }
  func nextSleep() async -> Duration {
    if !sleeps.isEmpty { return sleeps.removeFirst() }
    return await withCheckedContinuation { listeners.append($0) }
  }
  func advance(_ seconds: TimeInterval) {
    time = time.addingTimeInterval(seconds)
    for (id, entry) in pending where entry.0 <= time {
      pending[id] = nil
      entry.1.resume()
    }
  }
}

private actor QueuedReader: FeedReading {
  var results: [FeedRead]
  var validators: [String?] = []
  init(_ results: [FeedRead]) { self.results = results }
  func read(source: Source, token: String, etag: String?) -> FeedRead {
    validators.append(etag)
    return results.isEmpty ? .failed(.offline) : results.removeFirst()
  }
  var calls: Int { validators.count }
}

private actor ParallelReader: FeedReading {
  var arrived = 0
  var waiter: CheckedContinuation<Void, Never>?
  func read(source: Source, token: String, etag: String?) async -> FeedRead {
    arrived += 1
    if arrived == 1 {
      await withCheckedContinuation { waiter = $0 }
    } else {
      waiter?.resume()
      waiter = nil
    }
    return .failed(.offline)
  }
}

private func makePoller(
  directory: URL, sources: [Source], reader: any FeedReading,
  clock: any PollClock = SystemPollClock()
) async throws -> Poller {
  let vault = InMemoryTokenVault()
  for source in sources { await vault.setToken("synthetic", for: source.id) }
  return try await Poller(
    sources: sources, vault: vault, cache: FeedCache(directory: directory),
    notices: NoticeStore(directory: directory),
    widgetWriter: WidgetCacheWriter(
      location: WidgetCacheLocation(url: directory.appending(path: "widget-cache.json"))),
    client: reader, clock: clock
  )
}

@Test func pollerLoadsCacheUpdatesETagAndKeepsLastFeedOnEveryFailure() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let feed = try fixture()
  let cache = FeedCache(directory: directory)
  try await cache.save(
    CachedFeed(feed: feed, etag: "old", readAt: Date(timeIntervalSince1970: 0)), sourceID: source.id
  )
  let reader = QueuedReader([
    .notModified(etag: "new"), .failed(.signedOut), .failed(.needsUpdate), .failed(.offline),
  ])
  let poller = try await makePoller(directory: directory, sources: [source], reader: reader)
  #expect(await poller.snapshots().first?.cached?.feed == feed)
  await poller.refresh()
  #expect(await poller.snapshots().first?.state == .connected)
  #expect(try await cache.load(sourceID: source.id)?.etag == "new")
  for expected in [SourceState.signedOut, .needsUpdate, .offline] {
    await poller.refresh()
    #expect(await poller.snapshots().first?.state == expected)
    #expect(await poller.snapshots().first?.cached?.feed == feed)
  }
  #expect(await reader.validators == ["old", "new", "new", "new"])
  #expect(await poller.storageFailed == false)
}

@Test func pollerWritesA200ToDiskAndStartsWithoutData() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let feed = try fixture()
  let reader = QueuedReader([.updated(feed, etag: "first")])
  let poller = try await makePoller(directory: directory, sources: [source], reader: reader)
  #expect(await poller.snapshots().first?.state == .noData)
  await poller.refresh()
  let saved = try #require(try await FeedCache(directory: directory).load(sourceID: source.id))
  #expect(saved.feed == feed)
  #expect(saved.etag == "first")
  #expect(await poller.snapshots().first?.state == .connected)
  let notices = try NoticeStore(directory: directory)
  #expect(await notices.bannerIDs(sourceID: source.id).isEmpty)
}

@Test func a304WithoutCachedDataStaysNoDataAndAMissingTokenIsSignedOut() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let reader = QueuedReader([.notModified(etag: nil)])
  let poller = try await makePoller(directory: directory, sources: [source], reader: reader)
  await poller.refresh()
  #expect(await poller.snapshots().first?.state == .noData)
  let emptyVaultPoller = try await Poller(
    sources: [source], vault: InMemoryTokenVault(), cache: FeedCache(directory: directory),
    notices: NoticeStore(directory: directory),
    widgetWriter: WidgetCacheWriter(
      location: WidgetCacheLocation(url: directory.appending(path: "widget-cache.json"))),
    client: reader
  )
  await emptyVaultPoller.refresh()
  #expect(await emptyVaultPoller.snapshots().first?.state == .signedOut)
  #expect(await reader.calls == 1)
}

@Test(.timeLimit(.minutes(1))) func pollingIntervalsOpenFreshnessWakeAndNetworkUseTheClock()
  async throws
{
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let feed = try fixture()
  let clock = ManualClock()
  let reader = QueuedReader(Array(repeating: .updated(feed, etag: "synthetic"), count: 10))
  let poller = try await makePoller(
    directory: directory, sources: [source], reader: reader, clock: clock)
  await poller.start()
  #expect(await clock.nextSleep() == .seconds(120))
  #expect(await reader.calls == 1)
  await poller.setPopoverOpen(true)
  #expect(await clock.nextSleep() == .seconds(30))
  #expect(await reader.calls == 1)
  await clock.advance(30)
  #expect(await clock.nextSleep() == .seconds(30))
  #expect(await reader.calls == 2)
  await poller.setPopoverOpen(false)
  #expect(await clock.nextSleep() == .seconds(120))
  await clock.advance(31)
  await poller.setPopoverOpen(true)
  #expect(await clock.nextSleep() == .seconds(30))
  #expect(await reader.calls == 3)
  await poller.didWake()
  await poller.networkDidChange()
  #expect(await reader.calls == 5)
  await poller.stop()
  await clock.advance(120)
  #expect(await reader.calls == 5)
}

@Test(.timeLimit(.minutes(1))) func sourcesAreReadInParallel() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let reader = ParallelReader()
  let poller = try await makePoller(
    directory: directory, sources: [source(), source()], reader: reader)
  await poller.refresh()
  #expect(await reader.arrived == 2)
  #expect(await poller.snapshots().allSatisfy { $0.state == .offline })
}

@Test(.timeLimit(.minutes(1))) func backgroundPollingRefreshesAfterTwoMinutes() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let clock = ManualClock()
  let reader = QueuedReader(Array(repeating: .updated(try fixture(), etag: nil), count: 3))
  let poller = try await makePoller(
    directory: directory, sources: [source()], reader: reader, clock: clock)
  await poller.start()
  #expect(await clock.nextSleep() == .seconds(120))
  await clock.advance(120)
  #expect(await clock.nextSleep() == .seconds(120))
  #expect(await reader.calls == 2)
  await poller.stop()
}

@Test func snapshotStreamStartsFromDiskAndPublishesRefreshResults() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let reader = QueuedReader([.updated(try fixture(), etag: nil)])
  let poller = try await makePoller(directory: directory, sources: [source()], reader: reader)
  var iterator = await poller.updates().makeAsyncIterator()
  #expect(await iterator.next()?.first?.state == .noData)
  await poller.refresh()
  #expect(await iterator.next()?.first?.state == .connected)
}

private actor HeldReader: FeedReading {
  let feed: AppFeed
  private var release: CheckedContinuation<Void, Never>?
  private var started = false
  private var startedWaiter: CheckedContinuation<Void, Never>?
  init(feed: AppFeed) { self.feed = feed }
  func read(source: Source, token: String, etag: String?) async -> FeedRead {
    await withCheckedContinuation { continuation in
      release = continuation
      started = true
      startedWaiter?.resume()
      startedWaiter = nil
    }
    return .updated(feed, etag: "synthetic")
  }
  func waitForRead() async {
    if started { return }
    await withCheckedContinuation { startedWaiter = $0 }
  }
  func finish() {
    release?.resume()
    release = nil
  }
}

@Test(.timeLimit(.minutes(1))) func stoppingDrainsReadBeforeSourceCacheCanBeRemoved() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let reader = HeldReader(feed: try fixture())
  let poller = try await makePoller(directory: directory, sources: [source], reader: reader)
  await poller.start()
  await reader.waitForRead()
  let stopped = Task { await poller.stop() }
  await reader.finish()
  await stopped.value
  let cache = FeedCache(directory: directory)
  #expect(try await cache.load(sourceID: source.id) != nil)
  try await cache.remove(sourceID: source.id)
  #expect(try await cache.load(sourceID: source.id) == nil)
}

@Test(.timeLimit(.minutes(1))) func checkEverySetsTheBackgroundIntervalAndCapsTheOpenOne()
  async throws
{
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let feed = try fixture()
  let clock = ManualClock()
  let reader = QueuedReader(Array(repeating: .updated(feed, etag: "synthetic"), count: 10))
  let poller = try await makePoller(
    directory: directory, sources: [source], reader: reader, clock: clock)
  // Set before start: no loop starts early, and the first wait uses the new interval.
  await poller.setBackgroundInterval(seconds: 300)
  #expect(await reader.calls == 0)
  await poller.start()
  #expect(await clock.nextSleep() == .seconds(300))
  // A change while running starts the wait over on the new interval, never under 30 seconds.
  await poller.setBackgroundInterval(seconds: 5)
  #expect(await clock.nextSleep() == .seconds(30))
  await poller.setBackgroundInterval(seconds: 600)
  #expect(await clock.nextSleep() == .seconds(600))
  // While the popover is open the app reads every 30 seconds, or sooner when Check every is.
  await clock.advance(31)
  await poller.setPopoverOpen(true)
  #expect(await clock.nextSleep() == .seconds(30))
  await poller.stop()
}

private actor MarkingReader: FeedReading {
  var feed: AppFeed
  var accept: Bool
  var marks: [([String], Bool)] = []
  init(feed: AppFeed, accept: Bool) {
    self.feed = feed
    self.accept = accept
  }
  func read(source: Source, token: String, etag: String?) -> FeedRead {
    .updated(feed, etag: nil)
  }
  func markRead(source: Source, token: String, ids: [String], read: Bool) -> Bool {
    marks.append((ids, read))
    if accept {
      for index in feed.notices.indices where ids.contains(feed.notices[index].id) {
        feed.notices[index].read = read
      }
    }
    return accept
  }
  func setAccept(_ value: Bool) { accept = value }
}

@Test func readMarksReachTheServerAfterAReadAndStayQueuedOnFailure() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = try source()
  let feed = try fixture()
  let notice = try #require(feed.notices.first)
  let reader = MarkingReader(feed: feed, accept: false)
  let poller = try await makePoller(directory: directory, sources: [source], reader: reader)
  await poller.refresh()
  #expect(await reader.marks.isEmpty)
  let notices = try NoticeStore(directory: directory)
  try await notices.setRead(true, id: notice.id, sourceID: source.id)
  // The poller keeps its own store; a fresh poller reads the saved queue.
  let next = try await makePoller(directory: directory, sources: [source], reader: reader)
  await next.syncReads()
  #expect(await reader.marks.map(\.0) == [[notice.id]])
  let kept = try NoticeStore(directory: directory)
  #expect(await kept.pendingReads(sourceID: source.id) == [notice.id: true])
  #expect(await kept.records(sourceID: source.id)[notice.id]?.read == true)
  await reader.setAccept(true)
  await next.syncReads()
  let saved = try NoticeStore(directory: directory)
  #expect(await saved.pendingReads(sourceID: source.id).isEmpty)
  #expect(await saved.records(sourceID: source.id)[notice.id]?.read == true)
  // The next feed carries the server's flag, so the mark holds without the queue.
  await next.refresh()
  #expect(await saved.records(sourceID: source.id)[notice.id]?.read == true)
}
