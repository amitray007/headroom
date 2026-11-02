import Foundation
import Testing

@testable import HeadroomKit

private actor Runner: CommandRunning {
  var calls: [[String]] = []
  let failing: Set<Int>
  let output: String
  init(failing: Set<Int> = [], output: String = "line one\nsynthetic failure\n") {
    self.failing = failing
    self.output = output
  }
  func run(_ arguments: [String]) -> (status: Int32, output: String) {
    calls.append(arguments)
    return (failing.contains(calls.count - 1) ? 1 : 0, output)
  }
}

private let bundled = URL(filePath: "/Applications/Headroom.app/Contents/Resources/headroom")
private let home = URL(filePath: "/Users/synthetic")
private func managed(binary: URL? = bundled) -> ManagedServer {
  ManagedServer(
    binary: binary, bundleID: "club.theblank.headroom.mac", home: home, uid: 501,
    shell: "/bin/zsh")
}
private let plist = "/Users/synthetic/Library/LaunchAgents/club.theblank.headroom.plist"

@Test func setUpRunsTheFourStepsInOrder() async throws {
  let runner = Runner()
  let seen = Counter()
  let steps = Log<ManagedServer.Step>()
  try await managed().setUp(
    runner: runner, exists: { [bundled.path, plist].contains($0) },
    answers: { await seen.next() >= 2 }, progress: steps.add,
    interval: .zero)
  let calls = await runner.calls
  #expect(calls.count == 2)
  #expect(calls[0] == [bundled.path, "--version"])
  #expect(
    calls[1] == [
      "/bin/zsh", "-l", "-c",
      "exec /usr/bin/env -i HOME=\"$HOME\" USER=\"$USER\" PATH=\"$PATH\" "
        + "HEADROOM_APP_BUNDLE_ID='club.theblank.headroom.mac' '\(bundled.path)' service install",
    ])
  #expect(await seen.value == 2)
  #expect(steps.values == ManagedServer.Step.allCases)
}

@Test func setUpNamesTheStepThatFailed() async {
  func failure(
    _ server: ManagedServer, runner: Runner, plistExists: Bool = true, answers: Bool = true
  )
    async -> ManagedServer.Failure?
  {
    do {
      try await server.setUp(
        runner: runner, exists: { $0 == plist ? plistExists : true }, answers: { answers },
        progress: { _ in }, attempts: 2, interval: .zero)
      return nil
    } catch { return error as? ManagedServer.Failure }
  }
  #expect(
    await failure(managed(binary: nil), runner: Runner())
      == .init(step: .place, detail: "This build of Headroom does not carry the server."))
  #expect(
    await failure(managed(), runner: Runner(failing: [0]))
      == .init(step: .place, detail: "synthetic failure"))
  #expect(
    await failure(managed(), runner: Runner(failing: [1]))
      == .init(step: .start, detail: "synthetic failure"))
  #expect(await failure(managed(), runner: Runner(), plistExists: false)?.step == .login)
  #expect(await failure(managed(), runner: Runner(), answers: false)?.step == .answer)
}

@Test func restartAndStopUseLaunchctlOnTheLabel() async throws {
  let runner = Runner()
  try await managed().restart(runner: runner)
  try await managed().stop(runner: runner)
  #expect(
    await runner.calls == [
      ["/bin/launchctl", "kickstart", "-k", "gui/501/club.theblank.headroom"],
      ["/bin/launchctl", "bootout", "gui/501/club.theblank.headroom"],
    ])
}

@Test func stoppingAStoppedServerIsNotAnError() async throws {
  let runner = Runner(failing: [0], output: "Boot-out failed: 3: No such process\n")
  try await managed().stop(runner: runner)
  await #expect(throws: LocalServerError.commandFailed("denied")) {
    try await managed().stop(runner: Runner(failing: [0], output: "denied\n"))
  }
}

@Test func removeUninstallsAndDeletesDataOnlyWhenAsked() async throws {
  let removed = Log<URL>()
  let runner = Runner()
  try await managed().remove(
    runner: runner, deleteData: false, removeItem: removed.add)
  #expect(await runner.calls == [[bundled.path, "service", "uninstall"]])
  #expect(removed.values.isEmpty)
  try await managed().remove(
    runner: Runner(), deleteData: true, removeItem: removed.add)
  #expect(
    removed.values == [
      home.appending(path: "Library/Application Support/Headroom", directoryHint: .isDirectory)
    ])
}

@Test func restartsOnlyWhenTheBundledVersionDiffers() {
  #expect(ManagedServer.needsRestart(runningVersion: "0.1.15", bundledVersion: "0.1.16"))
  #expect(
    !ManagedServer.needsRestart(runningVersion: "0.1.16", bundledVersion: "headroom v0.1.16\n"))
  #expect(!ManagedServer.needsRestart(runningVersion: nil, bundledVersion: "0.1.16"))
  #expect(!ManagedServer.needsRestart(runningVersion: "0.1.16", bundledVersion: "not a version"))
}

@Test func theOwnerIsTheProgramTheLaunchAgentRuns() {
  let label = "club.theblank.headroom"
  #expect(LocalServer.owner(label: label, program: bundled.path) == .app)
  #expect(LocalServer.owner(label: label, program: "/opt/homebrew/bin/headroom") == .homebrew)
  #expect(
    LocalServer.owner(label: label, program: "/usr/local/Cellar/headroom/0.1.15/bin/headroom")
      == .homebrew)
  #expect(LocalServer.owner(label: "homebrew.mxcl.headroom", program: nil) == .homebrew)
  #expect(
    LocalServer.owner(label: label, program: "/Users/synthetic/.local/bin/headroom") == .other)
  #expect(LocalServer.owner(label: label, program: nil) == .other)
}

@Test func theProgramComesFromEitherPlistKey() throws {
  func data(_ plist: [String: Any]) throws -> Data {
    try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
  }
  #expect(
    try LocalServer.programPath(plist: data(["ProgramArguments": ["/a/headroom", "serve"]]))
      == "/a/headroom")
  #expect(try LocalServer.programPath(plist: data(["Program": "/b/headroom"])) == "/b/headroom")
  #expect(LocalServer.programPath(plist: Data("nope".utf8)) == nil)
}

@Test func supportDetailsHoldNoSecrets() {
  let text = managed().supportDetails(
    appVersion: "0.4.0", serverVersion: "0.1.16", bundledVersion: "0.1.16", running: true,
    failure: .init(step: .start, detail: "synthetic failure"))
  #expect(text.contains("Failed step: Start Headroom"))
  #expect(!text.localizedCaseInsensitiveContains("token"))
}

private actor Counter {
  var value = 0
  func next() -> Int {
    value += 1
    return value
  }
}
