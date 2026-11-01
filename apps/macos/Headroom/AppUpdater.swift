import AppKit
import HeadroomKit
import Observation

/// Looks for a newer Mac release and, when the owner presses Update, runs Homebrew's upgrade.
/// Nothing here installs without that press.
@MainActor @Observable
final class AppUpdater {
  enum Install: Equatable {
    case idle, running
    case failed(String)
  }

  /// What a manual check found, for the line under the button that asked.
  enum Outcome: Equatable { case available, upToDate, failed }

  private(set) var result: UpdateCheck.Result?
  private(set) var checkedAt: Date?
  private(set) var checking = false
  private(set) var install = Install.idle
  /// Whether the last check reached GitHub. A failure keeps the last known result.
  private(set) var lastCheckFailed = false

  let running: String
  /// Homebrew's path, or nil when this Mac has none in the usual places.
  let brew: String?
  private let client = UpdateClient()
  private var schedule: Task<Void, Never>?

  init(
    running: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
      as? String ?? "0.0.0",
    brew: String? = HomebrewUpdate.locate()
  ) {
    self.running = running
    self.brew = brew
  }

  var available: (version: String, notesURL: URL, publishedAt: Date?)? {
    if case .available(let version, let url, let date) = result { return (version, url, date) }
    return nil
  }

  /// Checks after a short delay, then every six hours, while `enabled`. Turning it off stops the
  /// schedule and clears a found update that is not being installed; an up-to-date result stays.
  func schedule(enabled: Bool) {
    schedule?.cancel()
    schedule = nil
    guard enabled else {
      if install != .running, available != nil { result = nil }
      return
    }
    schedule = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(8)) } catch { return }
      while !Task.isCancelled {
        await self?.check()
        do { try await Task.sleep(for: .seconds(6 * 3600)) } catch { return }
      }
    }
  }

  @discardableResult
  func check() async -> Outcome {
    guard !checking else { return outcome }
    checking = true
    defer { checking = false }
    let reading = await client.check(running: running)
    lastCheckFailed = !reading.fresh
    if reading.fresh { checkedAt = Date() }
    // A failed check keeps what an earlier one found.
    if let known = reading.result { result = known }
    return outcome
  }

  private var outcome: Outcome {
    if lastCheckFailed { return .failed }
    return available == nil ? .upToDate : .available
  }

  /// Runs `brew upgrade --cask ...` away from the main actor, then reopens the app.
  func installWithHomebrew() {
    guard let brew, install != .running else { return }
    install = .running
    Task {
      let done = await Self.runBrew(at: brew)
      if done.status == 0 {
        Self.relaunch()
      } else {
        install = .failed(HomebrewUpdate.reason(output: done.output, status: done.status))
      }
    }
  }

  private nonisolated static func runBrew(at path: String) async -> (status: Int32, output: String)
  {
    await Task.detached {
      let process = Process()
      process.executableURL = URL(filePath: path)
      process.arguments = HomebrewUpdate.arguments
      // A Finder-launched app has a bare PATH; brew needs its own folder and the system tools.
      var environment = ProcessInfo.processInfo.environment
      environment["HOMEBREW_NO_ENV_HINTS"] = "1"
      environment["PATH"] =
        "\((path as NSString).deletingLastPathComponent):/usr/bin:/bin:/usr/sbin:/sbin"
      process.environment = environment
      process.standardInput = FileHandle.nullDevice
      let pipe = Pipe()
      process.standardOutput = pipe
      process.standardError = pipe
      do { try process.run() } catch {
        return (-1, "Could not start Homebrew.")
      }
      // Reads until brew closes the pipe, so a full pipe never stalls it.
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }.value
  }

  /// A detached shell reopens the app by bundle id after this process has quit.
  private static func relaunch() {
    if let id = Bundle.main.bundleIdentifier {
      let shell = Process()
      shell.executableURL = URL(filePath: "/bin/sh")
      shell.arguments = ["-c", "sleep 1; open -b \"$0\"", id]
      shell.standardInput = FileHandle.nullDevice
      shell.standardOutput = FileHandle.nullDevice
      shell.standardError = FileHandle.nullDevice
      try? shell.run()
    }
    NSApp.terminate(nil)
  }

  func copyCommand() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(HomebrewUpdate.command, forType: .string)
  }
}
