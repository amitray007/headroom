import Foundation
import Testing

@testable import HeadroomKit

private let home = URL(filePath: "/Users/synthetic")

private actor RunnerSpy: CommandRunning {
  var calls: [[String]] = []
  let status: [Int32]
  init(status: [Int32]) { self.status = status }
  func run(_ arguments: [String]) -> (status: Int32, output: String) {
    calls.append(arguments)
    return (status[min(calls.count - 1, status.count - 1)], "line one\nsynthetic failure\n")
  }
}

@Test func findPrefersAnExistingLaunchAgent() {
  let files: Set = [
    "/Users/synthetic/Library/LaunchAgents/homebrew.mxcl.headroom.plist",
    "/opt/homebrew/bin/headroom", "/opt/homebrew/Cellar/headroom",
  ]
  let server = LocalServer.find(home: home, exists: files.contains)
  #expect(
    server?.install
      == .launchAgent(
        label: "homebrew.mxcl.headroom",
        plist: home.appending(path: "Library/LaunchAgents/homebrew.mxcl.headroom.plist")))
}

@Test func findTellsHomebrewFromTheInstallScript() {
  let brew: Set = ["/usr/local/bin/headroom", "/usr/local/Cellar/headroom"]
  #expect(
    LocalServer.find(home: home, exists: brew.contains)?.install
      == .homebrew(brew: URL(filePath: "/usr/local/bin/brew")))
  let script: Set = ["/usr/local/bin/headroom"]
  #expect(
    LocalServer.find(home: home, exists: script.contains)?.install
      == .binary(URL(filePath: "/usr/local/bin/headroom")))
  let local: Set = ["/Users/synthetic/.local/bin/headroom"]
  #expect(
    LocalServer.find(home: home, exists: local.contains)?.install
      == .binary(home.appending(path: ".local/bin/headroom")))
  #expect(LocalServer.find(home: home, exists: { _ in false }) == nil)
}

@Test func stepsStartTheServerNowAndAtLogin() {
  let agent = LocalServer(
    install: .launchAgent(label: "club.theblank.headroom", plist: URL(filePath: "/a b/x.plist")))
  #expect(
    agent.steps(uid: 501, shell: "/bin/zsh") == [
      .init(arguments: ["/bin/launchctl", "bootstrap", "gui/501", "/a b/x.plist"], mayFail: true),
      .init(arguments: ["/bin/launchctl", "kickstart", "gui/501/club.theblank.headroom"], mayFail: false),
    ])
  let binary = LocalServer(install: .binary(URL(filePath: "/Users/o'neil/.local/bin/headroom")))
  #expect(
    binary.steps(uid: 501, shell: "/bin/zsh").map(\.arguments) == [
      ["/bin/zsh", "-l", "-c", "'/Users/o'\\''neil/.local/bin/headroom' service install"]
    ])
}

@Test func startWaitsForTheServerToAnswer() async throws {
  let runner = RunnerSpy(status: [1, 0])
  let server = LocalServer(
    install: .launchAgent(label: "club.theblank.headroom", plist: URL(filePath: "/x.plist")))
  let checks = Counter()
  try await server.start(
    runner: runner, uid: 501, shell: "/bin/zsh", answers: { await checks.next() >= 3 },
    interval: .zero)
  #expect(await runner.calls.count == 2)
  #expect(await checks.value == 3)
}

@Test func startReportsAFailedCommandAndASilentServer() async {
  let server = LocalServer(install: .binary(URL(filePath: "/x/headroom")))
  await #expect(throws: LocalServerError.commandFailed("synthetic failure")) {
    try await server.start(
      runner: RunnerSpy(status: [1]), uid: 501, shell: "/bin/zsh", answers: { true })
  }
  await #expect(throws: LocalServerError.notAnswering) {
    try await server.start(
      runner: RunnerSpy(status: [0]), uid: 501, shell: "/bin/zsh", answers: { false },
      attempts: 3, interval: .zero)
  }
}

private actor Counter {
  var value = 0
  func next() -> Int {
    value += 1
    return value
  }
}
