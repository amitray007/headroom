import AppKit
import HeadroomKit
import SwiftUI

/// Headroom on this Mac: the server the app carries, and the existing installs it connects to.
extension AppModel {
  /// The server bundled in this app. `binary` is nil in a build that does not carry it.
  var managedServer: ManagedServer {
    ManagedServer(
      binary: Bundle.main.url(forResource: "headroom", withExtension: nil),
      bundleID: Bundle.main.bundleIdentifier ?? "club.theblank.headroom.mac",
      home: FileManager.default.homeDirectoryForCurrentUser, uid: getuid(),
      shell: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
  }

  /// A source is This Mac while a server is installed here and it points at a candidate port.
  /// Without an install, a source at 127.0.0.1 is a tunnel to another computer.
  func isThisMac(_ source: Source) -> Bool {
    localOwner != nil && LocalServer.isThisMac(source.baseURL)
  }

  var thisMacSource: SourceSnapshot? { sources.first { isThisMac($0.source) } }

  /// Where this Mac's Headroom answers now, else where its source points, else the first candidate.
  var thisMacURL: URL {
    localURL ?? thisMacSource?.source.baseURL ?? LocalServer.defaultURL
  }

  /// The app's own server was added and has stopped.
  var localStopped: Bool {
    localOwner == .app && !localAvailable && !localBusy && thisMacSource != nil
  }

  /// Quitting stops the app's server when the owner chose that.
  var stopsWithApp: Bool {
    localOwner == .app && localAvailable && !preferences.keepServerRunning && !synthetic
  }

  func showSetup(_ mode: SetupFlow.Mode) { setupWindow.show(model: self, mode: mode) }

  func requestSourceSheet(_ request: SourceSheetRequest, _ open: OpenSettingsAction) {
    selectedPane = .sources
    sourceSheetRequest = request
    openSettingsWindow(open)
  }

  func openConnectPage(_ baseURL: URL) {
    NSWorkspace.shared.open(Pairing.connectPage(baseURL: baseURL) ?? baseURL)
  }

  // MARK: Launch and quit

  /// At launch: with Keep running off the server follows the app, and after an app update the
  /// server restarts when the bundled binary is newer than the one running.
  func reconcileManagedServer() async {
    guard localOwner == .app, !synthetic else { return }
    guard localAvailable else {
      if !preferences.keepServerRunning { await startLocal() }
      return
    }
    let bundled = await managedServer.bundledVersion(runner: ProcessRunner())
    if ManagedServer.needsRestart(runningVersion: localVersion, bundledVersion: bundled) {
      await restartLocal()
    }
  }

  func stopForQuit() async {
    try? await managedServer.stop(runner: ProcessRunner())
  }

  // MARK: Controls

  func restartLocal() async {
    await control(expectRunning: true) { try await $0.restart(runner: ProcessRunner()) }
  }

  func stopLocal() async {
    await control(expectRunning: false) { try await $0.stop(runner: ProcessRunner()) }
  }

  /// Takes the app's server off this Mac. Its data stays unless the owner chose to delete it.
  func removeLocal(deleteData: Bool) async {
    // Removing the install clears `localOwner`, which the match depends on.
    let mine = sources.filter { isThisMac($0.source) }
    await control(expectRunning: false) {
      try await $0.remove(
        runner: ProcessRunner(), deleteData: deleteData,
        removeItem: { try FileManager.default.removeItem(at: $0) })
    }
    for snapshot in mine { await removeSource(snapshot) }
  }

  func revealLocalData() {
    let server = managedServer
    let target =
      FileManager.default.fileExists(atPath: server.dataDirectory.path)
      ? server.dataDirectory : server.binary ?? server.plist
    NSWorkspace.shared.activateFileViewerSelecting([target])
  }

  func copySupportDetails(failure: ManagedServer.Failure? = nil) async {
    let server = managedServer
    let text = server.supportDetails(
      appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
        as? String ?? "unknown",
      serverVersion: localVersion,
      bundledVersion: await server.bundledVersion(runner: ProcessRunner()),
      running: localAvailable, port: localURL.flatMap(LocalServer.port(of:)), failure: failure)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  private func control(
    expectRunning: Bool, _ action: (ManagedServer) async throws -> Void
  ) async {
    guard !localBusy else { return }
    localBusy = true
    defer { localBusy = false }
    do {
      try await action(managedServer)
      // The server takes a moment to start or to let go of its port.
      for _ in 0..<20 where await FeedClient().thisMacAvailable() != expectRunning {
        try await Task.sleep(for: .seconds(1))
      }
    } catch {
      self.error = error.localizedDescription
    }
    await checkLocal()
  }
}

// MARK: Pairing

/// One pairing, from the code to the saved source. Cancelling stops the poll.
@MainActor @Observable
final class PairingSession {
  enum State: Equatable {
    case idle, starting
    case waiting(code: String)
    /// Approved; the source is being checked and saved.
    case saving
    case denied, expired, tooOld
    case failed(String)
  }

  private(set) var state = State.idle
  /// The code shows and the browser can open the page again.
  var waiting: Bool {
    if case .waiting = state { return true }
    return false
  }
  private var page: URL?
  private var task: Task<Void, Never>?

  var active: Bool {
    switch state {
    case .starting, .waiting, .saving: true
    default: false
    }
  }

  /// Starts a pairing with the server and opens the approval page. `connect` receives the token
  /// and saves the source; its error ends the pairing with a message.
  func begin(baseURL: URL, connect: @escaping @MainActor (String) async throws -> Void) {
    cancel()
    state = .starting
    let name = Pairing.deviceName(macName: Host.current().localizedName ?? "Mac")
    task = Task { [weak self] in
      do {
        let outcome = try await Pairing.run(
          baseURL: baseURL, name: name, transport: FeedClient(),
          onCode: { code in
            Task { @MainActor in self?.show(code, baseURL: baseURL) }
          })
        guard let self, !Task.isCancelled else { return }
        switch outcome {
        case .approved(let token):
          state = .saving
          try await connect(token)
        case .denied: state = .denied
        case .expired: state = .expired
        case .serverTooOld: state = .tooOld
        }
      } catch is CancellationError {
        return
      } catch let error as SourceError {
        self?.state = .failed(
          error == .insecureURL
            ? "Use HTTPS, or a local network HTTP address." : "Enter a valid server address.")
      } catch {
        self?.state = .failed(error.localizedDescription)
      }
    }
  }

  func cancel() {
    task?.cancel()
    task = nil
    state = .idle
  }

  func fail(_ message: String) {
    cancel()
    state = .failed(message)
  }

  func openPage() {
    if let page { NSWorkspace.shared.open(page) }
  }

  private func show(_ code: PairingCode, baseURL: URL) {
    guard state == .starting else { return }
    page = Pairing.approvalPage(baseURL: baseURL, code: code.code)
    state = .waiting(code: code.code)
    openPage()
  }
}

// MARK: Setup

/// The Set Up Headroom window's work: put the server in place, start it, then pair with it.
@MainActor @Observable
final class SetupFlow {
  enum Mode { case install, connect }
  enum StepState { case waiting, running, done, failed }

  let mode: Mode
  let pairing = PairingSession()
  private(set) var steps: [ManagedServer.Step: StepState] = [:]
  private(set) var failure: ManagedServer.Failure?
  private(set) var installing = false
  private(set) var installed: Bool
  private(set) var finished = false
  private var closed = false

  init(mode: Mode) {
    self.mode = mode
    installed = mode == .connect
    resetSteps()
  }

  /// The track above the body: Install, Create account, Connect accounts.
  var stage: Int { finished ? 2 : installed ? 1 : 0 }

  func state(of step: ManagedServer.Step) -> StepState { steps[step] ?? .waiting }

  func run(model: AppModel) async {
    if !installed { await install(model) }
    if installed && !closed { await pair(model) }
  }

  /// Try again after a failed step, or Start over after a denied or expired pairing.
  func retry(model: AppModel) {
    Task { await run(model: model) }
  }

  func close() {
    closed = true
    pairing.cancel()
  }

  private func install(_ model: AppModel) async {
    failure = nil
    resetSteps()
    installing = true
    defer { installing = false }
    do {
      try await model.managedServer.setUp(
        runner: ProcessRunner(), exists: { FileManager.default.fileExists(atPath: $0) },
        answers: { await FeedClient().thisMacAvailable() },
        progress: { step in Task { @MainActor in self.mark(step) } })
      for step in ManagedServer.Step.allCases { steps[step] = .done }
      installed = true
      await model.checkLocal()
    } catch let failed as ManagedServer.Failure {
      steps[failed.step] = .failed
      failure = failed
    } catch {
      failure = ManagedServer.Failure(step: .answer, detail: error.localizedDescription)
    }
  }

  private func pair(_ model: AppModel) async {
    guard let url = await FeedClient().discoverThisMac(preferring: model.thisMacURL)?.url else {
      pairing.fail("Headroom does not answer on this Mac. Start it, then try again.")
      return
    }
    pairing.begin(baseURL: url) { [self] token in
      try await model.saveSource(
        id: model.thisMacSource?.id, name: "This Mac", url: url.absoluteString, token: token)
      await model.checkLocal()
      finished = true
    }
  }

  private func mark(_ step: ManagedServer.Step) {
    guard installing else { return }
    for earlier in ManagedServer.Step.allCases.prefix(while: { $0 != step }) {
      steps[earlier] = .done
    }
    steps[step] = .running
  }

  private func resetSteps() {
    for step in ManagedServer.Step.allCases { steps[step] = .waiting }
  }
}
