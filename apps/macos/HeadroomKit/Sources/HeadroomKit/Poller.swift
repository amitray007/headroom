import Foundation

public protocol PollClock: Sendable {
  func now() async -> Date
  func sleep(for duration: Duration) async throws
}

public struct SystemPollClock: PollClock {
  public init() {}
  public func now() -> Date { Date() }
  public func sleep(for duration: Duration) async throws { try await Task.sleep(for: duration) }
}

public struct SourceSnapshot: Identifiable, Sendable {
  public var id: UUID { source.id }

  public let source: Source
  public var state: SourceState
  public var cached: CachedFeed?

  public init(source: Source, state: SourceState = .noData, cached: CachedFeed? = nil) {
    self.source = source
    self.state = state
    self.cached = cached
  }
}

extension SourceSnapshot {
  /// True when two polls show the same thing: same sources, states, accounts, notices, summary
  /// and refresh interval. Only the read time differs, and redrawing every view for that is wasted work.
  public static func sameReadings(_ a: [SourceSnapshot], _ b: [SourceSnapshot]) -> Bool {
    a.count == b.count
      && zip(a, b).allSatisfy { old, new in
        old.source == new.source && old.state == new.state
          && old.cached?.feed.accounts == new.cached?.feed.accounts
          && old.cached?.feed.notices == new.cached?.feed.notices
          && old.cached?.feed.summary == new.cached?.feed.summary
          && old.cached?.feed.refreshIntervalMs == new.cached?.feed.refreshIntervalMs
      }
  }
}

public actor Poller {
  private var values: [SourceSnapshot]
  private let client: any FeedReading
  private let vault: any TokenVault
  private let cache: FeedCache
  private let notices: NoticeStore
  private let widgetWriter: WidgetCacheWriter
  private let clock: any PollClock
  private var loop: Task<Void, Never>?
  private var refreshTask: Task<Void, Never>?
  private var popoverOpen = false
  private var running = false
  private var scheduleRevision: UInt64 = 0
  private var observers: [UUID: AsyncStream<[SourceSnapshot]>.Continuation] = [:]
  public private(set) var storageFailed = false

  public init(
    sources: [Source], vault: any TokenVault, cache: FeedCache = FeedCache(),
    notices: NoticeStore, widgetWriter: WidgetCacheWriter = WidgetCacheWriter(),
    client: any FeedReading = FeedClient(), clock: any PollClock = SystemPollClock()
  ) async throws {
    self.vault = vault
    self.cache = cache
    self.notices = notices
    self.widgetWriter = widgetWriter
    self.client = client
    self.clock = clock
    var loaded: [SourceSnapshot] = []
    for source in sources {
      let saved = try await cache.load(sourceID: source.id)
      loaded.append(
        SourceSnapshot(source: source, state: saved == nil ? .noData : .connected, cached: saved))
    }
    values = loaded
  }

  public func snapshots() -> [SourceSnapshot] { values }
  private var backgroundSeconds = 120
  public var interval: Duration {
    .seconds(popoverOpen ? min(30, backgroundSeconds) : backgroundSeconds)
  }

  /// The owner's Check every setting. The current wait starts over on the new interval.
  public func setBackgroundInterval(seconds: Int) {
    let seconds = max(30, seconds)
    guard seconds != backgroundSeconds else { return }
    backgroundSeconds = seconds
    guard running else { return }
    loop?.cancel()
    scheduleRevision &+= 1
    loop = Task { [weak self] in await self?.runLoop() }
  }

  public func updates() -> AsyncStream<[SourceSnapshot]> {
    let id = UUID()
    let (stream, continuation) = AsyncStream<[SourceSnapshot]>.makeStream(
      bufferingPolicy: .bufferingNewest(1))
    observers[id] = continuation
    continuation.yield(values)
    continuation.onTermination = { [weak self] _ in Task { await self?.removeObserver(id) } }
    return stream
  }

  private func removeObserver(_ id: UUID) { observers[id] = nil }

  public func start() {
    guard !running else { return }
    running = true
    scheduleRevision &+= 1
    loop = Task { [weak self] in
      guard !Task.isCancelled else { return }
      await self?.refresh()
      guard !Task.isCancelled else { return }
      await self?.runLoop()
    }
  }

  public func stop() async {
    running = false
    scheduleRevision &+= 1
    loop?.cancel()
    loop = nil
    // Drain an in-flight read before callers remove a source or replace its credentials/cache.
    await refreshTask?.value
  }

  private func runLoop() async {
    while !Task.isCancelled {
      do { try await clock.sleep(for: interval) } catch { return }
      guard !Task.isCancelled else { return }
      await refresh()
    }
  }

  public func setPopoverOpen(_ open: Bool) async {
    guard open != popoverOpen else { return }
    popoverOpen = open
    loop?.cancel()
    loop = nil
    scheduleRevision &+= 1
    let revision = scheduleRevision
    if open {
      let now = await clock.now()
      if values.contains(where: { $0.cached.map { now.timeIntervalSince($0.readAt) > 30 } ?? true })
      {
        await refresh()
      }
    }
    guard running, revision == scheduleRevision else { return }
    loop = Task { [weak self] in await self?.runLoop() }
  }

  public func didWake() async { await refresh() }
  public func networkDidChange() async { await refresh() }

  public func refresh() async {
    if let refreshTask {
      await refreshTask.value
      return
    }
    let task = Task { await self.performRefresh() }
    refreshTask = task
    await task.value
  }

  private func performRefresh() async {
    defer { refreshTask = nil }
    let inputs = values
    let client = client
    let vault = vault
    let results = await withTaskGroup(of: (UUID, FeedRead).self) { group in
      for value in inputs {
        group.addTask {
          do {
            guard let token = try await vault.token(for: value.id) else {
              return (value.id, .failed(.signedOut))
            }
            return (
              value.id,
              await client.read(source: value.source, token: token, etag: value.cached?.etag)
            )
          } catch { return (value.id, .failed(.offline)) }
        }
      }
      var results: [(UUID, FeedRead)] = []
      for await result in group { results.append(result) }
      return results
    }
    let now = await clock.now()
    storageFailed = false
    for (id, result) in results {
      guard let index = values.firstIndex(where: { $0.id == id }) else { continue }
      switch result {
      case .updated(let feed, let etag):
        values[index].cached = CachedFeed(feed: feed, etag: etag, readAt: now)
        values[index].state = .connected
      case .notModified(let etag):
        if values[index].cached != nil {
          values[index].cached?.readAt = now
          if let etag { values[index].cached?.etag = etag }
          values[index].state = .connected
        } else {
          values[index].state = .noData
        }
      case .failed(let state): values[index].state = state
      }
      if values[index].state == .connected, let saved = values[index].cached {
        do {
          try await cache.save(saved, sourceID: id)
          try await notices.ingest(sourceID: id, notices: saved.feed.notices, now: now)
        } catch { storageFailed = true }
      }
    }
    do { try widgetWriter.write(sources: values, now: now) } catch { storageFailed = true }
    for observer in observers.values { observer.yield(values) }
  }
}
