import Foundation

/// A Headroom server installed on this Mac, found by the files its installers leave. The app can
/// start an installed server; it never installs one. Starting a server changes no account.
public struct LocalServer: Sendable, Equatable {
  public enum Install: Sendable, Equatable {
    /// `headroom service install` or `brew services` wrote a launch agent.
    case launchAgent(label: String, plist: URL)
    /// The Homebrew formula, started with `brew services`.
    case homebrew(brew: URL)
    /// The install script's binary, started with `headroom service install`.
    case binary(URL)
  }

  /// One command of a start. A step that may fail covers "already loaded" style answers.
  public struct Step: Sendable, Equatable {
    public let arguments: [String]
    public let mayFail: Bool
  }

  public static let url = URL(string: "http://127.0.0.1:8080")!

  public let install: Install

  public static func find(home: URL, exists: (String) -> Bool) -> LocalServer? {
    let agents = home.appending(path: "Library/LaunchAgents")
    for label in ["club.theblank.headroom", "homebrew.mxcl.headroom"] {
      let plist = agents.appending(path: "\(label).plist")
      if exists(plist.path) { return LocalServer(install: .launchAgent(label: label, plist: plist)) }
    }
    for prefix in ["/opt/homebrew", "/usr/local"]
    where exists("\(prefix)/bin/headroom") && exists("\(prefix)/Cellar/headroom") {
      return LocalServer(install: .homebrew(brew: URL(filePath: "\(prefix)/bin/brew")))
    }
    for path in [home.appending(path: ".local/bin/headroom").path, "/usr/local/bin/headroom"]
    where exists(path) {
      return LocalServer(install: .binary(URL(filePath: path)))
    }
    return nil
  }

  /// Every way starts the server now and at each login, as the install guide does. Installers run
  /// in a login shell so the service keeps the owner's PATH and finds the sign-in CLIs.
  public func steps(uid: UInt32, shell: String) -> [Step] {
    switch install {
    case .launchAgent(let label, let plist):
      [
        Step(arguments: ["/bin/launchctl", "bootstrap", "gui/\(uid)", plist.path], mayFail: true),
        Step(arguments: ["/bin/launchctl", "kickstart", "gui/\(uid)/\(label)"], mayFail: false),
      ]
    case .homebrew(let brew):
      [Step(arguments: [shell, "-l", "-c", "\(quoted(brew.path)) services start headroom"], mayFail: false)]
    case .binary(let binary):
      [Step(arguments: [shell, "-l", "-c", "\(quoted(binary.path)) service install"], mayFail: false)]
    }
  }

  /// Runs the steps, then waits for the server to answer on its port.
  public func start(
    runner: some CommandRunning, uid: UInt32, shell: String,
    answers: @Sendable () async -> Bool, attempts: Int = 30, interval: Duration = .seconds(1)
  ) async throws {
    for step in steps(uid: uid, shell: shell) {
      let result = await runner.run(step.arguments)
      if result.status != 0 && !step.mayFail {
        throw LocalServerError.commandFailed(
          result.output.split(whereSeparator: \.isNewline).last.map(String.init) ?? "")
      }
    }
    for attempt in 0..<attempts {
      if await answers() { return }
      if attempt < attempts - 1 { try await Task.sleep(for: interval) }
    }
    throw LocalServerError.notAnswering
  }

  private func quoted(_ path: String) -> String {
    "'" + path.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }
}

public enum LocalServerError: Error, Equatable, LocalizedError {
  case commandFailed(String), notAnswering

  public var errorDescription: String? {
    switch self {
    case .commandFailed(let detail):
      detail.isEmpty
        ? "Headroom could not start on this Mac." : "Headroom could not start on this Mac: \(detail)"
    case .notAnswering:
      "Headroom started but does not answer on port 8080. Check its log, then try again."
    }
  }
}

public protocol CommandRunning: Sendable {
  func run(_ arguments: [String]) async -> (status: Int32, output: String)
}

public struct ProcessRunner: CommandRunning {
  public init() {}

  public func run(_ arguments: [String]) async -> (status: Int32, output: String) {
    await Task.detached {
      guard let executable = arguments.first else { return (-1, "") }
      let process = Process()
      let pipe = Pipe()
      process.executableURL = URL(filePath: executable)
      process.arguments = Array(arguments.dropFirst())
      process.standardOutput = pipe
      process.standardError = pipe
      process.standardInput = FileHandle.nullDevice
      do { try process.run() } catch { return (-1, error.localizedDescription) }
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }.value
  }
}
