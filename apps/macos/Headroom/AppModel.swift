import AppKit
import HeadroomKit
import Network
import Observation
import SwiftUI

struct NoticeItem: Identifiable {
  let source: SourceSnapshot
  let notice: NativeNotice
  var read: Bool
  var id: String { "\(source.id)/\(notice.id)" }

  /// Same notice, read state and source state: nothing on screen would change. Every field a
  /// row shows is compared, so a renamed account or a moved time still redraws.
  func shows(like other: NoticeItem) -> Bool {
    id == other.id && read == other.read && source.state == other.source.state
      && source.source.name == other.source.source.name && notice.title == other.notice.title
      && notice.message == other.notice.message && notice.occurredAt == other.notice.occurredAt
      && notice.accountLabel == other.notice.accountLabel
      && notice.provider == other.notice.provider && notice.tone == other.notice.tone
  }
}

enum NoticePhase { case loading, ready, failed }

/// Sidebar order: General first, as in macOS Settings, then where readings come from, then
/// how they show.
enum SettingsPane: String, CaseIterable, Identifiable {
  case general = "General"
  case sources = "Sources"
  case menuBar = "Menu Bar"
  case accounts = "Accounts"
  case notifications = "Notifications"
  var id: String { rawValue }
}

@MainActor @Observable
final class AppModel {
  var sources: [SourceSnapshot] = []
  var notices: [NoticeItem] = []
  var noticePhase: NoticePhase = .loading
  var preferences = DisplayPreferences() {
    didSet {
      if preferences.appearance != oldValue.appearance { applyAppearance() }
      if preferences.demo != oldValue.demo { Task { await self.applyDemo() } }
      if preferences.checkSeconds != oldValue.checkSeconds {
        let seconds = preferences.checkSeconds
        Task { await self.poller?.setBackgroundInterval(seconds: seconds) }
      }
      if preferences.checkForUpdates != oldValue.checkForUpdates, ready, !synthetic {
        updates.schedule(enabled: preferences.checkForUpdates)
      }
    }
  }
  var enabledKinds: [String: Bool] = [:]
  var selectedPane: SettingsPane = .general
  var error: String?
  var ready = false
  var busy = false
  var localAvailable = false
  /// An installed Headroom server on this Mac that the app can start, when one is not answering.
  var localServer: LocalServer?
  var localStarting = false
  var now = Date()
  var synthetic = false
  var captureState: String?
  var popoverPresented = false
  /// A request to open the Share window with these account keys picked. The menu bar controller
  /// opens it and clears it, as it does for `popoverPresented`.
  var shareRequest: Set<String>?
  var bannerNoticeID: String?
  private var pendingBannerNoticeID: String?
  private var pendingBannerContent: NativeNotice?
  private var popoverVisible = false
  let banners = NotificationBanners()
  let updates = AppUpdater()
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

  var refreshing = false
  /// What this Mac may do to each source's Refresh Every. Asked when Settings, General opens.
  var refreshAccess: [UUID: RefreshAccess] = [:]
  var settingRefresh = false
  /// Each source's last read. Kept apart from `sources` so a poll that only moves the read time
  /// updates the "Updated" line instead of every account row.
  private(set) var readTimes: [UUID: Date] = [:]
  /// Demo Mode replaces every account and notice with a made-up feed; real sources keep polling.
  private(set) var demoSources: [SourceSnapshot] = []
  var displaySources: [SourceSnapshot] { preferences.demo ? demoSources : sources }
  /// The popover's source selector. A filter for a removed source falls back to all sources.
  var popoverSources: [SourceSnapshot] {
    guard let filter = preferences.sourceFilter,
      displaySources.contains(where: { $0.id == filter })
    else { return displaySources }
    return displaySources.filter { $0.id == filter }
  }
  var popoverAccounts: [AccountItem] {
    Presentation.accounts(popoverSources, preferences: preferences)
  }
  var accounts: [AccountItem] { Presentation.accounts(displaySources, preferences: preferences) }
  var allAccounts: [AccountItem] {
    Presentation.accounts(displaySources, preferences: preferences, includeHidden: true)
  }
  var unread: Int { notices.filter { !$0.read }.count }
  /// The notices of the sources the popover shows.
  var popoverNotices: [NoticeItem] {
    let shown = Set(popoverSources.map(\.id))
    return notices.filter { shown.contains($0.source.id) }
  }
  /// The app-wide appearance, not `preferredColorScheme`: SwiftUI leaves a window on the last
  /// forced scheme when the choice returns to System, while `nil` here follows macOS again.
  private func applyAppearance() {
    NSApp.appearance =
      switch preferences.appearance {
      case .system: nil
      case .light: NSAppearance(named: .aqua)
      case .dark: NSAppearance(named: .darkAqua)
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
      banners.onOpen = { [weak self] sourceID, noticeID, content in
        guard let self else { return }
        self.requestBannerNotice(sourceID: sourceID, noticeID: noticeID, content: content)
      }
      banners.install()
      noticeStore = try NoticeStore()
      preferences = try await displayStore.load()
      enabledKinds = await noticeStore?.enabledKinds() ?? [:]
      try await connect(try await sourceStore.load())
      ready = true
      updates.schedule(enabled: preferences.checkForUpdates)
      await checkLocal()
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
      noticePhase = .failed
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
    apply(await poller.snapshots())
    await loadNotices()
    let stream = await poller.updates()
    observer = Task { [weak self] in
      for await snapshots in stream {
        guard !Task.isCancelled, let self, self.generation == current else { return }
        self.apply(snapshots)
        await self.loadNotices()
        // Demo notices are made up; only real ones become banners.
        if let noticeStore = self.noticeStore, !self.synthetic, !self.preferences.demo {
          await self.banners.deliver(self.notices, store: noticeStore)
        }
        if await poller.storageFailed {
          self.error = "Could not save the latest readings on this Mac."
        }
      }
    }
    await poller.setBackgroundInterval(seconds: preferences.checkSeconds)
    await poller.start()
  }

  private func apply(_ snapshots: [SourceSnapshot]) {
    let times = Dictionary(
      snapshots.compactMap { snapshot in snapshot.cached.map { (snapshot.id, $0.readAt) } },
      uniquingKeysWith: max)
    if times != readTimes { readTimes = times }
    if !SourceSnapshot.sameReadings(sources, snapshots) { sources = snapshots }
  }

  /// When the servers last refreshed the accounts the popover shows: the newest account reading.
  /// The footer's tooltip; the footer itself counts from this Mac's last check.
  var refreshedAt: Date? {
    popoverSources.flatMap { $0.cached?.feed.accounts ?? [] }
      .compactMap { Formatting.date(milliseconds: $0.observedAt) }.max()
  }

  /// Each source's Refresh Every in minutes, from its last feed.
  func serverRefreshMinutes(_ snapshot: SourceSnapshot) -> Int? {
    snapshot.cached.map { $0.feed.refreshIntervalMs / 60_000 }
  }

  func checkRefreshAccess() async {
    guard !synthetic else { return }
    let client = FeedClient()
    var access: [UUID: RefreshAccess] = [:]
    var asks: [(UUID, Source, String)] = []
    for snapshot in sources {
      if let token = try? await vault.token(for: snapshot.id) {
        asks.append((snapshot.id, snapshot.source, token))
      } else {
        access[snapshot.id] = .unknown
      }
    }
    // Sources answer in parallel, so one slow server does not hold up the rest.
    await withTaskGroup(of: (UUID, RefreshAccess).self) { group in
      for (id, source, token) in asks {
        group.addTask { (id, await client.refreshAccess(source: source, token: token)) }
      }
      for await (id, result) in group { access[id] = result }
    }
    if access != refreshAccess { refreshAccess = access }
  }

  /// Sets Refresh Every on each source whose token may change it. Read-only sources keep theirs.
  func setRefresh(minutes: Int) async {
    guard !settingRefresh else { return }
    settingRefresh = true
    defer { settingRefresh = false }
    let client = FeedClient()
    let targets = sources.filter { refreshAccess[$0.id] == .allowed }
    var writes: [(UUID, Source, String)] = []
    var saved: Set<UUID> = []
    for snapshot in targets {
      if let token = try? await vault.token(for: snapshot.id) {
        writes.append((snapshot.id, snapshot.source, token))
      }
    }
    await withTaskGroup(of: (UUID, Bool).self) { group in
      for (id, source, token) in writes {
        group.addTask {
          (id, await client.setRefresh(source: source, token: token, minutes: minutes))
        }
      }
      for await (id, ok) in group where ok { saved.insert(id) }
    }
    // Named in source order, whatever order the servers answered in.
    let failed = targets.filter { !saved.contains($0.id) }.map(\.source.name)
    if !failed.isEmpty {
      error =
        "Could not change Refresh Every on \(failed.joined(separator: ", ")). Check that the source is online."
    }
    // Read again so each feed reports its new interval.
    await poller?.refresh()
  }

  /// The later of the last poll and the reading the snapshot carries.
  func readAt(_ snapshot: SourceSnapshot) -> Date? {
    [readTimes[snapshot.id], snapshot.cached?.readAt].compactMap { $0 }.max()
  }

  func setOpen(_ open: Bool) async {
    popoverVisible = open
    if open { await presentBannerNotice() }
    await poller?.setPopoverOpen(open)
  }
  func requestShare(_ accounts: Set<String>) { shareRequest = accounts }
  func requestBannerNotice(sourceID: UUID, noticeID: String, content: NativeNotice? = nil) {
    pendingBannerNoticeID = "\(sourceID)/\(noticeID)"
    pendingBannerContent = content
    popoverPresented = true
    NSApp.activate()
  }
  /// The refresh button spins for at least half a second, so a fast read still shows it worked.
  func readSources() async {
    guard !refreshing else { return }
    refreshing = true
    let started = ContinuousClock.now
    if !preferences.demo { await poller?.refresh() }
    try? await Task.sleep(until: started + .milliseconds(600))
    refreshing = false
  }

  func applyDemo() async {
    if preferences.demo {
      do {
        guard let url = Bundle.main.url(forResource: "demo", withExtension: "json") else {
          throw CocoaError(.fileReadNoSuchFile)
        }
        let feed = try DemoFeed.current(Data(contentsOf: url), now: Date())
        let source = try Source(
          id: Self.demoSourceID, name: "Demo",
          baseURL: URL(string: "https://demo.example.invalid")!)
        demoSources = [
          SourceSnapshot(
            source: source, state: .connected,
            cached: CachedFeed(feed: feed, etag: nil, readAt: Date()))
        ]
      } catch {
        self.error = "Could not load the demo accounts."
      }
    } else {
      demoSources = []
    }
    await loadNotices()
  }
  private static let demoSourceID = UUID(uuidString: "00000000-0000-4000-8000-00000000DE70")!

  func loadNotices() async {
    if preferences.demo {
      // Demo notices live in memory only; their read state is never saved.
      let kept = Dictionary(uniqueKeysWithValues: notices.map { ($0.id, $0.read) })
      publish(
        notices: demoSources.flatMap { snapshot in
          (snapshot.cached?.feed.notices ?? []).map {
            let notice = NativeNotice($0, sourceName: snapshot.source.name)
            return NoticeItem(
              source: snapshot, notice: notice, read: kept["\(snapshot.id)/\(notice.id)"] ?? false)
          }
        }.sorted { $0.notice.occurredAt > $1.notice.occurredAt })
      if noticePhase != .ready { noticePhase = .ready }
      return
    }
    guard let noticeStore else { return }
    var items: [NoticeItem] = []
    for snapshot in sources {
      do {
        try await noticeStore.updateSourceState(
          sourceID: snapshot.id, signedOut: snapshot.state == .signedOut, now: now)
      } catch { self.error = "Could not save source sign-in state." }
      let records = await noticeStore.records(sourceID: snapshot.id)
      if snapshot.state == .signedOut, let record = records[NoticeStore.sourceSignOutID] {
        items.append(
          NoticeItem(
            source: snapshot,
            notice: NativeNotice(signedOutSource: snapshot.source, firstSeen: record.firstSeen),
            read: record.read))
      }
      items += (snapshot.cached?.feed.notices ?? []).map {
        NoticeItem(
          source: snapshot, notice: NativeNotice($0, sourceName: snapshot.source.name),
          read: records[$0.id]?.read ?? false)
      }
    }
    let phase: NoticePhase =
      sources.isEmpty || sources.contains { $0.cached != nil }
      ? .ready : (sources.contains { $0.state == .noData } ? .loading : .failed)
    if noticePhase != phase { noticePhase = phase }
    publish(notices: items.sorted { $0.notice.occurredAt > $1.notice.occurredAt })
    await presentBannerNotice()
  }

  /// Every poll rebuilds the notices. Assigning an equal list would still redraw every view
  /// that reads it, so only a visible change is published.
  private func publish(notices items: [NoticeItem]) {
    guard
      items.count != notices.count
        || zip(items, notices).contains(where: { !$0.shows(like: $1) })
    else { return }
    notices = items
  }

  func presentBannerNotice() async {
    guard popoverVisible, let id = pendingBannerNoticeID else { return }
    var item = notices.first { $0.id == id }
    if item == nil, let content = pendingBannerContent,
      let source = sources.first(where: { "\($0.id)/\(content.id)" == id })
    {
      let kept = NoticeItem(source: source, notice: content, read: true)
      notices.insert(kept, at: 0)
      item = kept
    }
    guard let item else { return }
    pendingBannerNoticeID = nil
    pendingBannerContent = nil
    do {
      try await noticeStore?.setRead(true, id: item.notice.id, sourceID: item.source.id)
      if let index = notices.firstIndex(where: { $0.id == id }) { notices[index].read = true }
      bannerNoticeID = id
    } catch { self.error = "Could not save notification read state." }
  }

  func setRead(_ value: Bool, item: NoticeItem) async {
    if preferences.demo {
      if let index = notices.firstIndex(where: { $0.id == item.id }) { notices[index].read = value }
      return
    }
    do {
      try await noticeStore?.setRead(value, id: item.notice.id, sourceID: item.source.id)
      await loadNotices()
    } catch { self.error = "Could not save notification read state." }
  }
  func markAllRead() async {
    if preferences.demo {
      for index in notices.indices { notices[index].read = true }
      return
    }
    do {
      try await noticeStore?.markAllRead()
      await loadNotices()
    } catch { self.error = "Could not mark notifications as read." }
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
    saveOrder(ids)
  }
  /// A drag in Settings, List: the dragged account takes the place of the one it was dropped on.
  func moveAccount(id: String, onto target: String) {
    var ids = allAccounts.map(\.id)
    guard let from = ids.firstIndex(of: id), let to = ids.firstIndex(of: target), from != to
    else { return }
    ids.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
    saveOrder(ids)
  }
  /// Saves the shown accounts' order and keeps every other saved position after them. In Demo
  /// Mode the list holds only made-up accounts, so the owner's real order must survive.
  private func saveOrder(_ ids: [String]) {
    let shown = Set(ids)
    preferences.accountOrder = ids + preferences.accountOrder.filter { !shown.contains($0) }
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
  func checkLocal() async {
    guard !synthetic else { return }
    localAvailable = await FeedClient().thisMacAvailable()
    localServer = LocalServer.find(
      home: FileManager.default.homeDirectoryForCurrentUser,
      exists: { FileManager.default.fileExists(atPath: $0) })
  }

  func startLocal() async {
    guard let localServer, !localStarting else { return }
    localStarting = true
    defer { localStarting = false }
    do {
      try await localServer.start(
        runner: ProcessRunner(), uid: getuid(),
        shell: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh",
        answers: { await FeedClient().thisMacAvailable() })
      localAvailable = true
    } catch {
      self.error = error.localizedDescription
    }
  }

  func openDashboard(_ source: Source) {
    NSWorkspace.shared.open(Presentation.dashboard(source))
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
      guard let url = Bundle.main.url(forResource: "popover", withExtension: "json") else {
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
        part.accounts = feed.accounts.filter { account in
          let source =
            account.id == "codex-personal"
            ? 2 : ["codex-work", "vercel"].contains(account.id) ? 1 : 0
          return source == index
        }
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
        client: SyntheticFeedReader(snapshots: snapshots),
        clock: SyntheticClock(time: now.addingTimeInterval(-420)))
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
      for read in notices where !["n1", "n2", "n3", "n5"].contains(read.notice.id) {
        try await noticeStore?.setRead(true, id: read.notice.id, sourceID: read.source.id)
      }
      await loadNotices()
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
