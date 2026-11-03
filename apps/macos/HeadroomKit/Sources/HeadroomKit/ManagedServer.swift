import Foundation

/// The server this app carries and sets up for the owner: the binary in `Contents/Resources`, run
/// through its own launch agent. Every command goes through `CommandRunning`, so none touches a
/// real service in tests. Nothing here changes an AI account.
public struct ManagedServer: Sendable, Equatable {
  public static let label = "club.theblank.headroom"

  /// The checklist the setup window shows, in the order the steps run.
  public enum Step: Sendable, Equatable, CaseIterable {
    case place, start, login, answer
    public var title: String {
      switch self {
      case .place: "Put Headroom in place"
      case .start: "Start Headroom"
      case .login: "Start it each time you log in"
      case .answer: "Make sure it answers"
      }
    }
  }

  /// A step that failed, with the last line the command printed.
  public struct Failure: Error, Equatable, LocalizedError {
    public let step: Step
    public let detail: String
    public init(step: Step, detail: String) {
      self.step = step
      self.detail = detail
    }
    public var errorDescription: String? {
      detail.isEmpty ? "\(step.title) failed." : "\(step.title) failed: \(detail)"
    }
  }

  /// The bundled binary, nil when this build carries none (a Debug build).
  public let binary: URL?
  public let bundleID: String
  public let home: URL
  public let uid: UInt32
  public let shell: String

  public init(binary: URL?, bundleID: String, home: URL, uid: UInt32, shell: String) {
    self.binary = binary
    self.bundleID = bundleID
    self.home = home
    self.uid = uid
    self.shell = shell
  }

  public var plist: URL { home.appending(path: "Library/LaunchAgents/\(Self.label).plist") }
  /// The server's own database and keys; the app's files live in another folder.
  public var dataDirectory: URL {
    home.appending(path: "Library/Application Support/Headroom", directoryHint: .isDirectory)
  }
  private var domain: String { "gui/\(uid)/\(Self.label)" }

  // MARK: Commands

  /// Writes the launch agent, which starts the server now and at each login. The bundle id lets
  /// Login Items show this app's name and icon. A login shell keeps the owner's PATH; `env -i`
  /// drops every other inherited setting, so a HEADROOM_DATA_DIR from a developer's shell cannot
  /// move this server's data or log.
  func installArguments(binary: URL) -> [String] {
    [
      shell, "-l", "-c",
      "exec /usr/bin/env -i HOME=\"$HOME\" USER=\"$USER\" PATH=\"$PATH\" "
        + "HEADROOM_APP_BUNDLE_ID=\(LocalServer.quoted(bundleID)) "
        + "\(LocalServer.quoted(binary.path)) service install",
    ]
  }

  func uninstallArguments(binary: URL) -> [String] {
    [binary.path, "service", "uninstall"]
  }

  var restartArguments: [String] { ["/bin/launchctl", "kickstart", "-k", domain] }
  /// The plist stays, so the server starts again at the next login.
  var stopArguments: [String] { ["/bin/launchctl", "bootout", domain] }

  // MARK: Set up

  /// Runs the four steps and reports each one as it starts. Throws the step that failed.
  public func setUp(
    runner: some CommandRunning, exists: @Sendable (String) -> Bool,
    answers: @Sendable () async -> Bool, progress: @Sendable (Step) -> Void,
    attempts: Int = 20, interval: Duration = .seconds(1)
  ) async throws {
    progress(.place)
    guard let binary, exists(binary.path) else {
      throw Failure(step: .place, detail: "This build of Headroom does not carry the server.")
    }
    let version = await runner.run([binary.path, "--version"])
    guard version.status == 0 else {
      throw Failure(step: .place, detail: Self.lastLine(version.output))
    }

    progress(.start)
    let install = await runner.run(installArguments(binary: binary))
    guard install.status == 0 else {
      throw Failure(step: .start, detail: Self.lastLine(install.output))
    }

    progress(.login)
    guard exists(plist.path) else {
      throw Failure(step: .login, detail: "The login item was not written.")
    }

    progress(.answer)
    for attempt in 0..<attempts {
      if await answers() { return }
      if attempt < attempts - 1 { try await Task.sleep(for: interval) }
    }
    throw Failure(step: .answer, detail: "Headroom started but does not answer on this Mac.")
  }

  // MARK: Control

  public func restart(runner: some CommandRunning) async throws {
    try await run(runner, restartArguments)
  }

  public func stop(runner: some CommandRunning) async throws {
    let result = await runner.run(stopArguments)
    // "Not loaded" means it is already stopped.
    if result.status != 0 && !Self.lastLine(result.output).isEmpty
      && !result.output.localizedCaseInsensitiveContains("could not find")
      && !result.output.localizedCaseInsensitiveContains("no such process")
    {
      throw LocalServerError.commandFailed(Self.lastLine(result.output))
    }
  }

  /// Removes the launch agent, and the server's data only when the owner chose to.
  public func remove(
    runner: some CommandRunning, deleteData: Bool, removeItem: @Sendable (URL) throws -> Void
  ) async throws {
    if let binary {
      try await run(runner, uninstallArguments(binary: binary))
    } else {
      // Without the bundled binary, take the agent out of launchd and delete its file.
      _ = await runner.run(stopArguments)
      try? removeItem(plist)
    }
    if deleteData { try removeItem(dataDirectory) }
  }

  private func run(_ runner: some CommandRunning, _ arguments: [String]) async throws {
    let result = await runner.run(arguments)
    guard result.status == 0 else {
      throw LocalServerError.commandFailed(Self.lastLine(result.output))
    }
  }

  // MARK: Decisions

  /// After an app update the bundled binary can be newer than the one running. Restarting makes
  /// the new binary run. Either version unknown means no restart.
  public static func needsRestart(runningVersion: String?, bundledVersion: String?) -> Bool {
    guard let running = normalized(runningVersion), let bundled = normalized(bundledVersion) else {
      return false
    }
    return running != bundled
  }

  /// `headroom --version` prints the version, perhaps after a name or with a leading "v".
  public static func normalized(_ version: String?) -> String? {
    guard
      let word = version?.split(whereSeparator: \.isWhitespace).last
        .map(String.init)?.trimmingCharacters(in: CharacterSet(charactersIn: "vV")),
      word.first?.isNumber == true
    else { return nil }
    return word
  }

  public func bundledVersion(runner: some CommandRunning) async -> String? {
    guard let binary else { return nil }
    let result = await runner.run([binary.path, "--version"])
    return result.status == 0 ? Self.normalized(result.output) : nil
  }

  // MARK: Helpers

  static func lastLine(_ output: String) -> String {
    output.split(whereSeparator: \.isNewline).last.map(String.init) ?? ""
  }

  /// The text "Copy details for support" puts on the pasteboard: no tokens, no account data.
  public func supportDetails(
    appVersion: String, serverVersion: String?, bundledVersion: String?, running: Bool,
    port: Int?, failure: Failure?
  ) -> String {
    var lines = [
      "Headroom for Mac \(appVersion)",
      "Server: \(serverVersion ?? "not answering")",
      "Bundled server: \(bundledVersion ?? (binary == nil ? "none in this build" : "unknown"))",
      "Running: \(running ? "yes" : "no")",
      "Port: \(port.map(String.init) ?? "none")",
      "Launch agent: \(plist.path)",
    ]
    if let failure {
      lines.append("Failed step: \(failure.step.title)")
      if !failure.detail.isEmpty { lines.append("Detail: \(failure.detail)") }
    }
    return lines.joined(separator: "\n")
  }
}

extension LocalServer {
  /// Who set the server up decides who updates it.
  public enum Owner: Sendable, Equatable {
    /// This app: the launch agent runs the binary inside an app bundle.
    case app
    case homebrew
    /// The install script, or any other install.
    case other
  }

  /// The path the launch agent runs, from its plist; nil when the plist names none.
  public static func programPath(plist data: Data) -> String? {
    guard
      let plist = try? PropertyListSerialization.propertyList(from: data, format: nil)
        as? [String: Any]
    else { return nil }
    if let program = plist["Program"] as? String { return program }
    return (plist["ProgramArguments"] as? [String])?.first
  }

  /// A launch agent that runs a binary inside an `.app` is the app's own. The Homebrew formula
  /// writes `homebrew.mxcl.headroom`, and `service install` run from a Homebrew binary points
  /// into its prefix.
  public static func owner(label: String, program: String?) -> Owner {
    if program?.contains(".app/") == true { return .app }
    if label.hasPrefix("homebrew.") { return .homebrew }
    if let program,
      program.hasPrefix("/opt/homebrew/") || program.contains("/Cellar/")
    {
      return .homebrew
    }
    return .other
  }

  /// The owner of what `find` found. A Homebrew or script binary has no launch agent yet.
  public func owner(readPlist: (URL) -> Data?) -> Owner {
    switch install {
    case .launchAgent(let label, let plist):
      Self.owner(label: label, program: readPlist(plist).flatMap(Self.programPath(plist:)))
    case .homebrew: .homebrew
    case .binary(let binary): Self.owner(label: "", program: binary.path)
    }
  }
}
