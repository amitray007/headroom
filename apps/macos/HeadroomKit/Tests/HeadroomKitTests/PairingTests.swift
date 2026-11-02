import Foundation
import Synchronization
import Testing

@testable import HeadroomKit

// MARK: The loop, against a stub transport

private final class ScriptedTransport: PairingTransport, @unchecked Sendable {
  struct State {
    var start: PairingCode?
    var statuses: [Result<PairingStatus, PairingError>]
    var polls = 0
  }
  let state: Mutex<State>
  init(start: PairingCode? = pairing, statuses: [Result<PairingStatus, PairingError>]) {
    state = Mutex(State(start: start, statuses: statuses))
  }
  var polls: Int { state.withLock(\.polls) }
  func start(baseURL: URL, name: String) async throws -> PairingCode? { state.withLock(\.start) }
  func status(baseURL: URL, deviceCode: String) async throws -> PairingStatus {
    try state.withLock { state in
      state.polls += 1
      let next = state.statuses[min(state.polls - 1, state.statuses.count - 1)]
      return try next.get()
    }
  }
}

private let pairing = PairingCode(
  code: "K7P-4QX", deviceCode: "synthetic-device", expiresIn: 600, interval: 2)
private let server = URL(string: "https://headroom.example.invalid")!

private func run(_ transport: ScriptedTransport, shown: Log<PairingCode> = Log())
  async throws -> PairingOutcome
{
  try await Pairing.run(
    baseURL: server, name: "Headroom for Mac · Synthetic", transport: transport,
    onCode: shown.add, sleep: { _ in })
}

@Test func pairingShowsTheCodeThenReturnsTheTokenOnce() async throws {
  let transport = ScriptedTransport(statuses: [
    .success(.pending), .success(.pending), .success(.approved(token: "hr_synthetic")),
  ])
  let shown = Log<PairingCode>()
  let outcome = try await run(transport, shown: shown)
  #expect(outcome == .approved(token: "hr_synthetic"))
  #expect(shown.values == [pairing])
  #expect(transport.polls == 3)
}

@Test func pairingReportsDeniedAndExpired() async throws {
  #expect(try await run(ScriptedTransport(statuses: [.success(.denied)])) == .denied)
  #expect(try await run(ScriptedTransport(statuses: [.success(.expired)])) == .expired)
}

@Test func pairingEndsWhenTheCodeLivesOut() async throws {
  let transport = ScriptedTransport(
    start: PairingCode(code: "AAA-BBB", deviceCode: "d", expiresIn: 6, interval: 2),
    statuses: [.success(.pending)])
  #expect(try await run(transport) == .expired)
  #expect(transport.polls == 3)
}

@Test func pairingAsksForATokenWhenTheServerHasNoPairing() async throws {
  let transport = ScriptedTransport(start: nil, statuses: [])
  #expect(try await run(transport) == .serverTooOld)
  #expect(transport.polls == 0)
}

@Test func pairingToleratesAFailedPollButNotFive() async throws {
  let flaky = ScriptedTransport(statuses: [
    .failure(.unavailable), .success(.approved(token: "hr_synthetic")),
  ])
  #expect(try await run(flaky) == .approved(token: "hr_synthetic"))
  await #expect(throws: PairingError.unavailable) {
    try await run(ScriptedTransport(statuses: [.failure(.unavailable)]))
  }
}

@Test func cancellingStopsThePoll() async {
  let transport = ScriptedTransport(statuses: [.success(.pending)])
  let task = Task {
    try await Pairing.run(
      baseURL: server, name: "x", transport: transport, onCode: { _ in },
      sleep: { _ in try await Task.sleep(for: .seconds(60)) })
  }
  task.cancel()
  await #expect(throws: CancellationError.self) { try await task.value }
  #expect(transport.polls == 0)
}

@Test func deviceNameIsCutToFortyCharacters() {
  #expect(Pairing.deviceName(macName: "Studio") == "Headroom for Mac · Studio")
  let long = Pairing.deviceName(macName: String(repeating: "m", count: 80))
  #expect(long.count == 40)
  #expect(long.hasPrefix("Headroom for Mac · "))
}

@Test func approvalPageIsTheServersPairRoute() {
  #expect(
    Pairing.approvalPage(baseURL: server, code: "K7P-4QX")?.absoluteString
      == "https://headroom.example.invalid/#/pair/K7P-4QX")
}

@Test func browserPagesForThisMacOpenOnLocalhost() {
  let local = LocalServer.url(port: 4323)
  #expect(
    Pairing.approvalPage(baseURL: local, code: "K7P-4QX")?.absoluteString
      == "http://localhost:4323/#/pair/K7P-4QX")
  #expect(Pairing.connectPage(baseURL: local)?.absoluteString == "http://localhost:4323/#/connect")
  #expect(Pairing.browserBase(server) == server)
}

// MARK: The HTTP mapping, against a stub session

private final class PairStub: URLProtocol, @unchecked Sendable {
  struct Reply: Sendable {
    var status = 200
    var body = ""
  }
  static let replies = Mutex<[String: [String: Reply]]>([:])
  static let paths = Mutex<[String: [String]]>([:])
  static func register(_ replies: [String: Reply]) -> URL {
    let host = "stub-\(UUID().uuidString.lowercased()).example.invalid"
    Self.replies.withLock { $0[host] = replies }
    return URL(string: "https://\(host)")!
  }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard let url = request.url, let host = url.host else { return }
    let reply = Self.replies.withLock { $0[host]?[url.path] } ?? Reply(status: 500)
    guard
      let response = HTTPURLResponse(
        url: url, statusCode: reply.status, httpVersion: nil,
        headerFields: ["Content-Type": "application/json"])
    else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

private let startBody =
  #"{"code":"K7P-4QX","deviceCode":"synthetic-device","expiresIn":600,"interval":2}"#

@Test func startReadsTheCodeFromTheServer() async throws {
  let url = PairStub.register(["/api/app/v1/pair": .init(body: startBody)])
  let client = FeedClient(protocolClasses: [PairStub.self])
  #expect(try await client.start(baseURL: url, name: "Synthetic") == pairing)
}

@Test func startOnAServerWithoutPairingIsNil() async throws {
  let url = PairStub.register(["/api/app/v1/pair": .init(status: 404, body: "{}")])
  let client = FeedClient(protocolClasses: [PairStub.self])
  #expect(try await client.start(baseURL: url, name: "Synthetic") == nil)
}

/// A server from before pairing rejects the POST in its token check, which allowed only GET.
@Test func startOnAServerWhoseTokenCheckRejectsPostIsNil() async throws {
  let url = PairStub.register([
    "/api/app/v1/pair": .init(status: 405, body: #"{"error":"method_not_allowed"}"#)
  ])
  let client = FeedClient(protocolClasses: [PairStub.self])
  #expect(try await client.start(baseURL: url, name: "Synthetic") == nil)
}

@Test func pollMapsEachStatusAndTreatsA404AsExpired() async throws {
  let client = FeedClient(protocolClasses: [PairStub.self])
  func status(_ reply: PairStub.Reply) async throws -> PairingStatus {
    let url = PairStub.register(["/api/app/v1/pair/token": reply])
    return try await client.status(baseURL: url, deviceCode: "synthetic-device")
  }
  #expect(try await status(.init(body: #"{"status":"pending"}"#)) == .pending)
  #expect(try await status(.init(body: #"{"status":"denied"}"#)) == .denied)
  #expect(try await status(.init(body: #"{"status":"expired"}"#)) == .expired)
  #expect(
    try await status(.init(body: #"{"status":"approved","token":"hr_synthetic"}"#))
      == .approved(token: "hr_synthetic"))
  #expect(try await status(.init(status: 404, body: "{}")) == .expired)
  await #expect(throws: PairingError.unavailable) {
    try await status(.init(body: #"{"status":"approved"}"#))
  }
  await #expect(throws: PairingError.unavailable) { try await status(.init(status: 500)) }
}
