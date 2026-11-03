import Foundation
import Synchronization
import Testing

@testable import HeadroomKit

private struct Stub: Sendable {
  var status = 200
  var headers: [String: String] = ["Content-Type": "application/json", "ETag": "\"synthetic\""]
  var body = Data()
  var error: URLError.Code?
  /// What `/healthz` answers, when it differs from every other path.
  var health: Data?
}

// URLSession calls URLProtocol on its queue; all shared test state is protected by Mutex.
private final class StubProtocol: URLProtocol, @unchecked Sendable {
  struct State: Sendable {
    var stubs: [String: Stub] = [:]
    var requests: [String: [URLRequest]] = [:]
  }
  static let state = Mutex(State())
  static func register(_ stub: Stub) throws -> Source {
    let host = "stub-\(UUID().uuidString.lowercased()).example.invalid"
    state.withLock { $0.stubs[host] = stub }
    return try source("https://\(host)")
  }
  /// A host, with the port when the URL has one: loopback tests tell servers apart by port.
  static func key(_ url: URL) -> String {
    (url.host ?? "") + (url.port.map { ":\($0)" } ?? "")
  }
  static func requests(for source: Source) -> [URLRequest] {
    state.withLock { $0.requests[key(source.baseURL)] ?? [] }
  }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard let url = request.url, url.host != nil else { return }
    let key = Self.key(url)
    let stub = Self.state.withLock { state in
      state.requests[key, default: []].append(request)
      return state.stubs[key]
    }
    guard let stub else {
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
      return
    }
    if url.path == "/healthz", let health = stub.health {
      guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)
      else { return }
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: health)
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    if let error = stub.error {
      client?.urlProtocol(self, didFailWithError: URLError(error))
      return
    }
    guard
      let response = HTTPURLResponse(
        url: url, statusCode: stub.status, httpVersion: nil, headerFields: stub.headers)
    else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    if !stub.body.isEmpty { client?.urlProtocol(self, didLoad: stub.body) }
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

@Test func feedRequestUsesGeneratedGETBearerETagAndCurrentOffset() async throws {
  let feed = try fixture()
  let data = try JSONEncoder().encode(feed)
  let source = try StubProtocol.register(Stub(body: data))
  let zone = try #require(TimeZone(secondsFromGMT: 19800))
  let client = FeedClient(protocolClasses: [StubProtocol.self], timeZone: { zone })
  let result = await client.read(
    source: source, token: "synthetic-read-token", etag: "\"previous\"")
  guard case .updated(let actual, let etag) = result else {
    Issue.record("Expected a decoded feed")
    return
  }
  #expect(actual == feed)
  #expect(etag == "\"synthetic\"")
  let request = try #require(StubProtocol.requests(for: source).first)
  #expect(request.httpMethod == "GET")
  #expect(request.url?.path == "/api/app/v1/feed")
  #expect(request.url?.query == "tz=330")
  #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-read-token")
  let validator = request.value(forHTTPHeaderField: "If-None-Match")
  #expect(validator == "\"previous\"")
  #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
  #expect(request.httpBody == nil)
}

@Test(arguments: [
  (401, SourceState.signedOut), (429, .offline), (500, .offline), (302, .offline),
])
func feedStatusMapping(_ status: Int, _ expected: SourceState) async throws {
  let source = try StubProtocol.register(
    Stub(status: status, body: Data("{\"error\":\"synthetic\"}".utf8)))
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  guard case .failed(let state) = await client.read(source: source, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected a source failure")
    return
  }
  #expect(state == expected)
}

@Test func aServerWithoutTheMacAPINeedsAnUpdateAndNamesItsVersion() async throws {
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  let old = try StubProtocol.register(
    Stub(status: 404, body: Data("{\"error\":\"synthetic\"}".utf8),
      health: Data("{\"status\":\"ok\",\"version\":\"0.1.14\"}".utf8)))
  guard case .incompatible(.needsUpdate, let version) = await client.read(
    source: old, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected a server update")
    return
  }
  #expect(version == "0.1.14")
  let silent = try StubProtocol.register(
    Stub(status: 404, body: Data("{\"error\":\"synthetic\"}".utf8)))
  guard case .incompatible(.needsUpdate, nil) = await client.read(
    source: silent, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected a server update with no version")
    return
  }
  await #expect(throws: SourceSetupError.needsUpdate(version: "0.1.14")) {
    try await client.verify(source: old, token: "synthetic")
  }
}

@Test func unchangedFeedDoesNotRequireAResponseBody() async throws {
  let source = try StubProtocol.register(Stub(status: 304))
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  guard
    case .notModified(let etag) = await client.read(
      source: source, token: "synthetic", etag: "\"synthetic\"")
  else {
    Issue.record("Expected 304")
    return
  }
  #expect(etag == "\"synthetic\"")
}

@Test(arguments: [URLError.Code.timedOut, .notConnectedToInternet, .cannotFindHost])
func networkErrorsAreOffline(_ error: URLError.Code) async throws {
  let source = try StubProtocol.register(Stub(error: error))
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  guard case .failed(.offline) = await client.read(source: source, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected offline")
    return
  }
}

@Test func invalidJSONIsOfflineAndAnOlderOrFutureFeedNeedsUpdate() async throws {
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  let malformed = try StubProtocol.register(Stub(body: Data("not json".utf8)))
  guard case .failed(.offline) = await client.read(source: malformed, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected decode failure")
    return
  }
  // A server from before read sync sends notices without the read flag.
  var older =
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture()))
    as? [String: Any] ?? [:]
  older["notices"] = (older["notices"] as? [[String: Any]])?.map {
    $0.filter { $0.key != "read" }
  }
  let old = try StubProtocol.register(
    Stub(body: JSONSerialization.data(withJSONObject: older)))
  guard
    case .incompatible(.needsUpdate, _) = await client.read(
      source: old, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected an older feed to need a server update")
    return
  }
  // A newer server: an added field and a new provider are read; a notice kind this build does
  // not know needs an app update.
  var newer =
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture()))
    as? [String: Any] ?? [:]
  newer["addedLater"] = ["synthetic": true]
  let added = try StubProtocol.register(Stub(body: JSONSerialization.data(withJSONObject: newer)))
  guard case .updated = await client.read(source: added, token: "synthetic", etag: nil) else {
    Issue.record("Expected an unknown field to be ignored")
    return
  }
  var accounts = newer["accounts"] as? [[String: Any]] ?? []
  accounts[0]["provider"] = "synthetic_provider"
  newer["accounts"] = accounts
  let provider = try StubProtocol.register(
    Stub(body: JSONSerialization.data(withJSONObject: newer)))
  guard
    case .updated(let read, _) = await client.read(
      source: provider, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected a new provider to be read")
    return
  }
  #expect(read.accounts[0].provider == "synthetic_provider")
  var notices = newer["notices"] as? [[String: Any]] ?? []
  notices[0]["kind"] = "synthetic_kind"
  newer["notices"] = notices
  let kind = try StubProtocol.register(
    Stub(body: JSONSerialization.data(withJSONObject: newer),
      health: Data("{\"status\":\"ok\",\"version\":\"0.3.0\"}".utf8)))
  guard
    case .incompatible(.appOutdated, "0.3.0") = await client.read(
      source: kind, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected an unknown notice kind to need an app update")
    return
  }
  var future = try fixture()
  future.apiVersion = 2
  future.serverVersion = "0.3.0"
  let source = try StubProtocol.register(Stub(body: JSONEncoder().encode(future)))
  guard
    case .incompatible(.appOutdated, "0.3.0") = await client.read(
      source: source, token: "synthetic", etag: nil)
  else {
    Issue.record("Expected API version refusal")
    return
  }
}

@Test func missingOrHeaderInjectedTokenNeverSendsARequest() async throws {
  let source = try StubProtocol.register(Stub())
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  for token in ["", "synthetic\r\nCookie: invalid"] {
    guard case .failed(.signedOut) = await client.read(source: source, token: token, etag: nil)
    else {
      Issue.record("Expected token refusal")
      return
    }
  }
  #expect(StubProtocol.requests(for: source).isEmpty)
}

@Test func transportHasABoundedTimeoutAndNoPersistentCookiesOrCache() {
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  let config = client.session.configuration
  #expect(config.timeoutIntervalForRequest == 15)
  #expect(config.timeoutIntervalForResource == 15)
  #expect(config.urlCache == nil)
  #expect(config.httpCookieStorage == nil)
  #expect(!config.httpShouldSetCookies)
  client.session.invalidateAndCancel()
}

@Test func redirectDelegateRefusesEvenSameOriginRedirects() throws {
  let session = URLSession(configuration: .ephemeral)
  defer { session.invalidateAndCancel() }
  let url = try #require(URL(string: "https://example.invalid"))
  let response = try #require(
    HTTPURLResponse(
      url: url, statusCode: 302, httpVersion: nil,
      headerFields: ["Location": "https://elsewhere.invalid"]))
  let decision = Mutex(true)
  let request = URLRequest(url: url)
  RefuseRedirects().urlSession(
    session, task: session.dataTask(with: request), willPerformHTTPRedirection: response,
    newRequest: request
  ) { redirected in
    decision.withLock { $0 = redirected != nil }
  }
  #expect(!decision.withLock { $0 })
}

@Test func sourceVerificationUsesOnlyWhoamiGETAndNoCookies() async throws {
  let source = try StubProtocol.register(
    Stub(body: Data("{\"apiVersion\":1,\"serverVersion\":\"synthetic\",\"tokenName\":null,\"scopes\":[\"read\"]}".utf8)))
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  try await client.verify(source: source, token: "synthetic-read-token")
  let request = try #require(StubProtocol.requests(for: source).first)
  #expect(request.httpMethod == "GET")
  #expect(request.url?.path == "/api/app/v1/whoami")
  #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-read-token")
  #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
  #expect(request.httpBody == nil)
  #expect(StubProtocol.requests(for: source).count == 1)
}

@Test(arguments: [
  (401, SourceSetupError.rejectedToken), (404, .needsUpdate(version: nil)), (500, .unavailable),
  (302, .unavailable),
])
func verificationRejectsFailures(_ status: Int, _ expected: SourceSetupError) async throws {
  let source = try StubProtocol.register(
    Stub(status: status, body: Data("{\"error\":\"synthetic\"}".utf8)))
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  await #expect(throws: expected) { try await client.verify(source: source, token: "synthetic") }
}

/// Makes these loopback ports answer `/healthz`; every other port refuses.
private func serveLoopback(_ ports: [Int: Data]) -> @Sendable () -> Void {
  let keys = ports.keys.map { "127.0.0.1:\($0)" }
  StubProtocol.state.withLock { state in
    for (port, health) in ports { state.stubs["127.0.0.1:\(port)"] = Stub(health: health) }
  }
  return {
    StubProtocol.state.withLock { state in
      for key in keys {
        state.stubs[key] = nil
        state.requests[key] = nil
      }
    }
  }
}

private let healthy = Data(#"{"status":"ok","version":"0.1.16"}"#.utf8)

// Every discovery test shares the loopback stubs, so they run one at a time.
@Suite(.serialized) struct LoopbackDiscoveryTests {
  @Test func discoveryAsksEveryCandidateForAnUnauthenticatedHealthCheck() async throws {
    let cleanup = serveLoopback([4325: healthy])
    defer { cleanup() }
    let client = FeedClient(protocolClasses: [StubProtocol.self])
    let found = try #require(await client.discoverThisMac())
    #expect(found == LocalServer.Found(url: LocalServer.url(port: 4325), version: "0.1.16"))
    #expect(await client.thisMacAvailable())
    let request = try #require(StubProtocol.requests(for: try source("http://127.0.0.1:4342")).first)
    #expect(request.httpMethod == "GET")
    #expect(request.url?.path == "/healthz")
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(StubProtocol.requests(for: try source("http://127.0.0.1:8080")).count >= 1)
  }

  @Test func discoveryPrefersTheCurrentPortThenCandidateOrder() async {
    let cleanup = serveLoopback([4324: healthy, 4330: healthy, 8080: healthy])
    defer { cleanup() }
    let client = FeedClient(protocolClasses: [StubProtocol.self])
    #expect(await client.discoverThisMac()?.url == LocalServer.url(port: 4324))
    #expect(
      await client.discoverThisMac(preferring: LocalServer.url(port: 4330))?.url
        == LocalServer.url(port: 4330))
    #expect(
      await client.discoverThisMac(preferring: LocalServer.url(port: 4335))?.url
        == LocalServer.url(port: 4324))
    #expect(
      await client.discoverThisMac(preferring: URL(string: "https://example.invalid:4330"))?.url
        == LocalServer.url(port: 4324))
  }

  @Test func discoveryAcceptsOnlyAnOkHealthAnswer() async {
    let cleanup = serveLoopback([
      4323: Data("ok".utf8), 4324: Data(#"{"status":"starting"}"#.utf8), 4325: Data("{}".utf8),
      4326: Data(#"{"version":"0.1.16"}"#.utf8),
    ])
    defer { cleanup() }
    let client = FeedClient(protocolClasses: [StubProtocol.self])
    #expect(await client.discoverThisMac() == nil)
    #expect(await client.thisMacAvailable() == false)
  }

  @Test func discoveryRefusesANon200Answer() async {
    StubProtocol.state.withLock { $0.stubs["127.0.0.1:4323"] = Stub(status: 503, body: Data(#"{"status":"ok"}"#.utf8)) }
    defer { StubProtocol.state.withLock { $0.stubs["127.0.0.1:4323"] = nil } }
    #expect(await FeedClient(protocolClasses: [StubProtocol.self]).discoverThisMac() == nil)
  }
}

@Test func thisMacIsALoopbackSourceOnACandidatePort() throws {
  for port in [4323, 4330, 4342, 8080] {
    #expect(LocalServer.isThisMac(LocalServer.url(port: port)))
  }
  #expect(LocalServer.isThisMac(try source("http://127.0.0.1:4323/").baseURL))
  for other in [
    "http://127.0.0.1:4322", "http://127.0.0.1:4343", "http://127.0.0.1", "http://localhost:4323",
    "https://127.0.0.1:4323", "http://192.168.1.20:4323", "http://127.0.0.1:4323/headroom",
    "https://headroom.example.invalid",
  ] {
    #expect(LocalServer.isThisMac(URL(string: other)!) == false, "\(other)")
  }
}

@Test func chosenPortIsThePreferredAnswerThenCandidateOrder() {
  #expect(LocalServer.candidatePorts == Array(4323...4342) + [8080])
  #expect(LocalServer.choose(answering: [], preferred: 4330) == nil)
  #expect(LocalServer.choose(answering: [4330, 4325], preferred: nil) == 4325)
  #expect(LocalServer.choose(answering: [4330, 4325], preferred: 4330) == 4330)
  #expect(LocalServer.choose(answering: [4325, 8080], preferred: 4330) == 4325)
  #expect(LocalServer.choose(answering: [8080], preferred: nil) == 8080)
  #expect(LocalServer.choose(answering: [4325, 8080], preferred: 8080) == 8080)
  #expect(LocalServer.choose(answering: [4325], preferred: 9999) == 4325)
}

@Test func refreshAccessFollowsTheTokenScopes() async throws {
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  func whoami(_ scopes: String?) throws -> Source {
    let field = scopes.map { #","scopes":\#($0)"# } ?? ""
    return try StubProtocol.register(
      Stub(
        body: Data(
          #"{"apiVersion":1,"serverVersion":"0.1.16","tokenName":"Mac"\#(field)}"#.utf8)))
  }
  #expect(
    await client.refreshAccess(source: try whoami(#"["read","refresh"]"#), token: "t") == .allowed)
  #expect(await client.refreshAccess(source: try whoami(#"["read"]"#), token: "t") == .readOnly)
  // A server from before the refresh scope sends no scopes; its tokens only read.
  #expect(await client.refreshAccess(source: try whoami(nil), token: "t") == .readOnly)
  let offline = try StubProtocol.register(Stub(error: .notConnectedToInternet))
  #expect(await client.refreshAccess(source: offline, token: "t") == .unknown)
  let revoked = try StubProtocol.register(Stub(status: 401))
  #expect(await client.refreshAccess(source: revoked, token: "t") == .unknown)
}

@Test func setRefreshSendsOnePutWithTheIntervalAndBearer() async throws {
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  let source = try StubProtocol.register(
    Stub(body: Data(#"{"refreshIntervalMinutes":2}"#.utf8)))
  #expect(await client.setRefresh(source: source, token: "synthetic", minutes: 2))
  let request = try #require(StubProtocol.requests(for: source).first)
  #expect(request.httpMethod == "PUT")
  #expect(request.url?.path == "/api/app/v1/settings/refresh")
  #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic")
  let body = try #require(request.httpBody ?? request.httpBodyStream.map(Data.init(reading:)))
  #expect(String(decoding: body, as: UTF8.self) == #"{"refreshIntervalMinutes":2}"#)

  // An interval the server does not offer never leaves the Mac; a refusal reports failure.
  let unused = try StubProtocol.register(Stub())
  #expect(!(await client.setRefresh(source: unused, token: "synthetic", minutes: 7)))
  #expect(StubProtocol.requests(for: unused).isEmpty)
  let readOnly = try StubProtocol.register(Stub(status: 403))
  #expect(!(await client.setRefresh(source: readOnly, token: "synthetic", minutes: 5)))
}

@Test func readMarksGoAsPutsOfAtMostFiveHundredIds() async throws {
  let client = FeedClient(protocolClasses: [StubProtocol.self])
  let source = try StubProtocol.register(Stub(body: Data(#"{"ids":["a"],"read":true}"#.utf8)))
  let ids = (0..<501).map { "notice-\($0)" }
  #expect(await client.markRead(source: source, token: "synthetic", ids: ids, read: true))
  let requests = StubProtocol.requests(for: source)
  #expect(requests.count == 2)
  let request = try #require(requests.first)
  #expect(request.httpMethod == "PUT")
  #expect(request.url?.path == "/api/app/v1/notices/read")
  #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic")
  struct Body: Decodable {
    let ids: [String]
    let read: Bool
  }
  let bodies = try requests.map {
    try JSONDecoder().decode(
      Body.self, from: try #require($0.httpBody ?? $0.httpBodyStream.map(Data.init(reading:))))
  }
  #expect(bodies.map(\.ids.count) == [500, 1])
  #expect(bodies.allSatisfy { $0.read })
  let refused = try StubProtocol.register(Stub(status: 401))
  #expect(!(await client.markRead(source: refused, token: "synthetic", ids: ["a"], read: false)))
}

extension Data {
  fileprivate init(reading stream: InputStream) {
    self.init()
    stream.open()
    defer { stream.close() }
    var buffer = [UInt8](repeating: 0, count: 1024)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      guard count > 0 else { break }
      append(buffer, count: count)
    }
  }
}
