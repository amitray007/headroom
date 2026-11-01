import AppKit
import HeadroomKit
import Network
import Observation
import SwiftUI
import WidgetKit

struct NoticeItem: Identifiable {
  let source: SourceSnapshot
  let notice: FeedNotice
  var read: Bool
  var id: String { "\(source.id)/\(notice.id)" }
}

enum SettingsPane: String, CaseIterable, Identifiable {
  case menuBar = "Menu Bar"
  case list = "List"
  case notifications = "Notifications"
  case sources = "Sources"
  case general = "General"
  var id: String { rawValue }
}

@MainActor @Observable
final class AppModel {
  var sources: [SourceSnapshot] = []
  var notices: [NoticeItem] = []
  var preferences = DisplayPreferences()
  var enabledKinds: [String: Bool] = [:]
  var selectedPane: SettingsPane = .menuBar
  var error: String?
  var ready = false
  var busy = false
  var localAvailable = false
  var now = Date()
  var synthetic = false
  var captureState: String?
  private var poller: Poller?
  private var observer: Task<Void, Never>?
  private var clockTask: Task<Void, Never>?
  private var monitor: NWPathMonitor?
  private var wakeObserver: NSObjectProtocol?
  private var generation = 0
  private var sourceStore = SourceStore()
  private var displayStore = DisplayPreferenceStore()
  private var vault: any TokenVault = KeychainTokenVault()
  private var noticeStore: NoticeStore?
  private var feedCache = FeedCache()

  var accounts: [AccountItem] { Presentation.accounts(sources, preferences: preferences) }
  var allAccounts: [AccountItem] {
    Presentation.accounts(sources, preferences: preferences, includeHidden: true)
  }
  var unread: Int { notices.filter { !$0.read }.count }
  var colorScheme: ColorScheme? {
    switch preferences.appearance {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }

  func start() async {
    #if DEBUG
      if CommandLine.arguments.contains("--synthetic") {
        synthetic = true
        do { try await loadSynthetic() } catch { self.error = "Could not load synthetic fixtures." }
        ready = true
        return
      }
    #endif
    do {
      noticeStore = try NoticeStore()
      preferences = try await displayStore.load()
      enabledKinds = await noticeStore?.enabledKinds() ?? [:]
      try await connect(try await sourceStore.load())
      ready = true
      localAvailable = await FeedClient().thisMacAvailable()
      let monitor = NWPathMonitor()
      monitor.pathUpdateHandler = { [weak self] _ in
        Task { @MainActor in await self?.poller?.networkDidChange() }
      }
      monitor.start(queue: DispatchQueue(label: "club.theblank.headroom.reachability"))
      self.monitor = monitor
      wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
      ) { [weak self] _ in Task { @MainActor in await self?.poller?.didWake() } }
      clockTask = Task { [weak self] in
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(60)) } catch { return }
          self?.now = Date()
        }
      }
    } catch {
      self.error = "Could not load local settings. Your saved data has been kept."
      ready = true
    }
  }

  private func connect(_ values: [Source]) async throws {
    guard let noticeStore else { return }
    generation += 1
    let current = generation
    observer?.cancel()
    let previousPoller = poller
    poller = nil
    await previousPoller?.stop()
    #if DEBUG
      let client: any FeedReading =
        synthetic ? SyntheticFeedReader(snapshots: sources) : FeedClient()
    #else
      let client: any FeedReading = FeedClient()
    #endif
    let poller = try await Poller(
      sources: values, vault: vault, cache: feedCache, notices: noticeStore, client: client)
    self.poller = poller
    // Publish the cached feed before starting any network request.
    sources = await poller.snapshots()
    await loadNotices()
    let stream = await poller.updates()
    observer = Task { [weak self] in
      for await snapshots in stream {
        guard !Task.isCancelled, let self, self.generation == current else { return }
        self.sources = snapshots
        await self.loadNotices()
        WidgetCenter.shared.reloadAllTimelines()
        if await poller.storageFailed {
          self.error = "Could not save the latest readings on this Mac."
        }
      }
    }
    await poller.start()
  }

  func setOpen(_ open: Bool) async { await poller?.setPopoverOpen(open) }
  func readSources() async { await poller?.refresh() }

  func loadNotices() async {
    guard let noticeStore else { return }
    var items: [NoticeItem] = []
    for snapshot in sources {
      let records = await noticeStore.records(sourceID: snapshot.id)
      items += (snapshot.cached?.feed.notices ?? []).map {
        NoticeItem(source: snapshot, notice: $0, read: records[$0.id]?.read ?? false)
      }
    }
    notices = items.sorted { $0.notice.occurredAt > $1.notice.occurredAt }
  }

  func setRead(_ value: Bool, item: NoticeItem) async {
    do {
      try await noticeStore?.setRead(value, id: item.notice.id, sourceID: item.source.id)
      await loadNotices()
    } catch { self.error = "Could not save notice read state." }
  }
  func markAllRead() async {
    do {
      try await noticeStore?.markAllRead()
      await loadNotices()
    } catch { self.error = "Could not mark notices as read." }
  }
  func setKind(_ kind: NoticeKind, enabled: Bool) async {
    do {
      try await noticeStore?.setEnabled(enabled, kind: kind)
      enabledKinds[kind.rawValue] = enabled
    } catch { self.error = "Could not save notification preferences." }
  }
  func saveDisplay() {
    let value = preferences
    Task {
      do { try await displayStore.save(value) } catch {
        self.error = "Could not save display preferences."
      }
    }
  }
  func moveAccount(_ item: AccountItem, by offset: Int) {
    var ids = allAccounts.map(\.id)
    guard let index = ids.firstIndex(of: item.id), ids.indices.contains(index + offset) else {
      return
    }
    ids.swapAt(index, index + offset)
    preferences.accountOrder = ids
    saveDisplay()
  }
  func saveSource(id: UUID?, name: String, url: String, token: String) async throws {
    guard !busy else { throw SourceSetupError.busy }
    busy = true
    defer { busy = false }
    let values = try await SourceSetup(store: sourceStore, vault: vault).save(
      id: id, name: name, url: url, token: token)
    let previousPoller = poller
    poller = nil
    await previousPoller?.stop()
    // A different URL must not display the previous server's cached accounts.
    if let id,
      sources.first(where: { $0.id == id })?.source.baseURL
        != values.first(where: { $0.id == id })?.baseURL
    {
      try await feedCache.remove(sourceID: id)
      try await noticeStore?.remove(sourceID: id)
    }
    try await connect(values)
  }
  func removeSource(_ snapshot: SourceSnapshot) async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    do {
      let values = sources.filter { $0.id != snapshot.id }.map(\.source)
      try await sourceStore.save(values)
      // Stop collection before removing credentials and local state.
      try await connect(values)
      try await vault.setToken(nil, for: snapshot.id)
      try await feedCache.remove(sourceID: snapshot.id)
      try await noticeStore?.remove(sourceID: snapshot.id)
    } catch { self.error = "Could not finish removing this source from this Mac." }
  }
  func moveSource(_ snapshot: SourceSnapshot, by offset: Int) async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    var values = sources.map(\.source)
    guard let index = values.firstIndex(where: { $0.id == snapshot.id }),
      values.indices.contains(index + offset)
    else { return }
    values.swapAt(index, index + offset)
    do {
      try await sourceStore.save(values)
      try await connect(values)
    } catch { self.error = "Could not save source order." }
  }
  func openDashboard(_ source: Source, accountID: String? = nil) {
    NSWorkspace.shared.open(Presentation.dashboard(source, accountID: accountID))
  }
}

#if DEBUG
  extension AppModel {
    func loadSynthetic() async throws {
      let directory = FileManager.default.temporaryDirectory.appending(
        path: "headroom-ui-\(UUID())")
      sourceStore = SourceStore(directory: directory)
      displayStore = DisplayPreferenceStore(directory: directory)
      feedCache = FeedCache(directory: directory)
      vault = InMemoryTokenVault()
      noticeStore = try NoticeStore(directory: directory)
      guard let url = Bundle.main.url(forResource: "demo", withExtension: "json") else {
        throw CocoaError(.fileReadNoSuchFile)
      }
      let feed = try JSONDecoder().decode(AppFeed.self, from: Data(contentsOf: url))
      now = Formatting.date(milliseconds: feed.generatedAt) ?? Date()
      let names = ["Home server", "Work server", "This Mac"]
      var snapshots: [SourceSnapshot] = []
      for index in 0..<3 {
        let source = try Source(
          name: names[index],
          baseURL: URL(
            string: index == 2 ? "http://127.0.0.1:8080" : "https://source-\(index).example.invalid"
          )!)
        var part = feed
        part.accounts = feed.accounts.enumerated().filter { $0.offset % 3 == index }.map(\.element)
        part.providerOrder = [
          .claude, .codex, .cursor, .copilot, .antigravity, .grok, .vercel_ai_gateway,
        ]
        part.notices = feed.notices.filter { notice in
          part.accounts.contains { $0.id == notice.connection.id }
        }
        // Summary fixtures belong to one source; the others explicitly report unknown money.
        if index > 0 {
          part.summary.extraSpend = []
          part.summary.monthlyPlanTotal = nil
          part.summary.nextLimitBack = nil
        }
        let cached = CachedFeed(feed: part, etag: nil, readAt: now.addingTimeInterval(-420))
        try await feedCache.save(cached, sourceID: source.id)
        try await vault.setToken("synthetic-only", for: source.id)
        snapshots.append(SourceSnapshot(source: source, state: .connected, cached: cached))
        try await noticeStore?.ingest(sourceID: source.id, notices: part.notices, now: now)
      }
      try await sourceStore.save(snapshots.map(\.source))
      sources = snapshots
      let poller = try await Poller(
        sources: snapshots.map(\.source), vault: vault, cache: feedCache,
        notices: noticeStore!,
        widgetWriter: WidgetCacheWriter(
          location: WidgetCacheLocation(url: directory.appending(path: "widgets.json"))),
        client: SyntheticFeedReader(snapshots: snapshots), clock: SyntheticClock(time: now))
      self.poller = poller
      let stream = await poller.updates()
      observer = Task { [weak self] in
        for await snapshots in stream {
          guard let self, !Task.isCancelled else { return }
          if self.captureState == nil {
            self.sources = snapshots
            await self.loadNotices()
          }
        }
      }
      await poller.start()
      await loadNotices()
      if let read = notices.last {
        try await noticeStore?.setRead(true, id: read.notice.id, sourceID: read.source.id)
        await loadNotices()
      }
      localAvailable = true
    }
  }

  private struct SyntheticClock: PollClock {
    let time: Date
    func now() -> Date { time }
    func sleep(for duration: Duration) async throws { try await Task.sleep(for: duration) }
  }

  private struct SyntheticFeedReader: FeedReading {
    let snapshots: [SourceSnapshot]
    func read(source: Source, token: String, etag: String?) async -> FeedRead {
      guard let feed = snapshots.first(where: { $0.id == source.id })?.cached?.feed else {
        return .failed(.offline)
      }
      return .updated(feed, etag: nil)
    }
  }
#endif
