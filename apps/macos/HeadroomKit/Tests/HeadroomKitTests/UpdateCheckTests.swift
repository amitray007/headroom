import Foundation
import Synchronization
import Testing

@testable import HeadroomKit

private func release(
  _ tag: String, draft: Bool = false, prerelease: Bool = false,
  published: String = "2026-11-01T10:00:00Z"
) -> String {
  """
  {"tag_name":"\(tag)","html_url":"https://github.com/amitray007/headroom/releases/tag/\(tag)",\
  "draft":\(draft),"prerelease":\(prerelease),"published_at":"\(published)"}
  """
}

private func list(_ releases: String...) -> Data {
  Data("[\(releases.joined(separator: ","))]".utf8)
}

private let published = Date(timeIntervalSince1970: 1_793_527_200)

private func page(_ tag: String) -> URL {
  URL(string: "https://github.com/amitray007/headroom/releases/tag/\(tag)")!
}

@Test func picksNewestMacReleaseAndIgnoresServerReleases() {
  let body = list(
    release("v9.0.0"), release("macos-v0.1.2"), release("macos-v0.2.0"), release("macos-v0.1.10"))
  #expect(
    UpdateCheck.evaluate(releases: body, running: "0.1.0")
      == .available(version: "0.2.0", notesURL: page("macos-v0.2.0"), publishedAt: published))
}

@Test func skipsDraftsAndPrereleases() {
  let body = list(
    release("macos-v0.3.0", draft: true), release("macos-v0.2.0", prerelease: true),
    release("macos-v0.1.1"))
  #expect(
    UpdateCheck.evaluate(releases: body, running: "0.1.0")
      == .available(version: "0.1.1", notesURL: page("macos-v0.1.1"), publishedAt: published))
}

@Test func equalOrNewerRunningVersionIsUpToDate() {
  let body = list(release("macos-v0.2.0"))
  #expect(UpdateCheck.evaluate(releases: body, running: "0.2.0") == .upToDate)
  #expect(UpdateCheck.evaluate(releases: body, running: "v0.2.0-beta.1") == .upToDate)
  #expect(UpdateCheck.evaluate(releases: body, running: "0.10.0") == .upToDate)
  #expect(UpdateCheck.evaluate(releases: list(), running: "0.1.0") == .upToDate)
}

@Test func versionsCompareByNumberNotText() {
  #expect(UpdateCheck.parts("v1.2.3+5") == [1, 2, 3])
  #expect(UpdateCheck.parts("0.10.0-rc.1") == [0, 10, 0])
  #expect(UpdateCheck.parts("beta") == nil)
  #expect(UpdateCheck.compare([0, 10], [0, 9, 9]) == .orderedDescending)
  #expect(UpdateCheck.compare([1, 0], [1]) == .orderedSame)
}

@Test func foreignReleasePageIsNotOffered() {
  let body = Data(
    #"[{"tag_name":"macos-v0.2.0","html_url":"https://example.invalid/x","draft":false,"prerelease":false}]"#
      .utf8)
  #expect(UpdateCheck.evaluate(releases: body, running: "0.1.0") == .upToDate)
}

@Test func unreadableBodyIsNotAnAnswer() {
  #expect(UpdateCheck.evaluate(releases: Data("{}".utf8), running: "0.1.0") == nil)
  #expect(UpdateCheck.evaluate(releases: list(), running: "nope") == nil)
}

@Test func homebrewReasonIsOneShortLine() {
  #expect(HomebrewUpdate.reason(output: "a\nError: no cask\n\n", status: 1) == "Error: no cask")
  #expect(HomebrewUpdate.reason(output: " \n", status: 3) == "Homebrew stopped with status 3.")
  #expect(HomebrewUpdate.reason(output: String(repeating: "x", count: 300), status: 1).count == 120)
  #expect(HomebrewUpdate.command == "brew upgrade --cask amitray007/headroom/headroom-mac")
  #expect(
    HomebrewUpdate.locate(isExecutable: { $0 == "/usr/local/bin/brew" }) == "/usr/local/bin/brew")
  #expect(HomebrewUpdate.locate(isExecutable: { _ in false }) == nil)
}

// URLSession calls URLProtocol on its queue; all shared test state is protected by Mutex.
private final class ReleasesProtocol: URLProtocol, @unchecked Sendable {
  struct State: Sendable {
    var status = 200
    var body = Data()
    var fail = false
    var requests: [URLRequest] = []
  }
  static let state = Mutex(State())
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let snapshot = Self.state.withLock { state in
      state.requests.append(request)
      return state
    }
    if snapshot.fail {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    guard let url = request.url,
      let response = HTTPURLResponse(
        url: url, statusCode: snapshot.status, httpVersion: nil,
        headerFields: ["ETag": "\"synthetic\""])
    else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    if !snapshot.body.isEmpty { client?.urlProtocol(self, didLoad: snapshot.body) }
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

@Test func clientSendsETagAndKeepsLastResultOnFailure() async throws {
  ReleasesProtocol.state.withLock {
    $0 = .init(status: 200, body: list(release("macos-v0.2.0")))
  }
  let client = UpdateClient(
    url: URL(string: "https://stub.example.invalid/releases")!,
    protocolClasses: [ReleasesProtocol.self])
  let first = await client.check(running: "0.1.0")
  #expect(first.fresh)
  #expect(
    first.result
      == .available(version: "0.2.0", notesURL: page("macos-v0.2.0"), publishedAt: published))

  ReleasesProtocol.state.withLock {
    $0.status = 304
    $0.body = Data()
  }
  let second = await client.check(running: "0.1.0")
  #expect(second == UpdateReading(result: first.result, fresh: true))

  ReleasesProtocol.state.withLock { $0.fail = true }
  let third = await client.check(running: "0.1.0")
  #expect(third == UpdateReading(result: first.result, fresh: false))

  let requests = ReleasesProtocol.state.withLock { $0.requests }
  #expect(requests[0].value(forHTTPHeaderField: "If-None-Match") == nil)
  #expect(requests[1].value(forHTTPHeaderField: "If-None-Match") == "\"synthetic\"")
  #expect(requests[0].value(forHTTPHeaderField: "Accept") == "application/vnd.github+json")
  #expect(requests[0].value(forHTTPHeaderField: "User-Agent")?.hasPrefix("Headroom-Mac/") == true)
}
