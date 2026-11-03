import Foundation

/// What the last releases check knows. `fresh` is false when this check failed and the result is
/// the last known one, or nil when nothing was ever read.
public struct UpdateReading: Equatable, Sendable {
  public let result: UpdateCheck.Result?
  public let fresh: Bool
}

/// Reads the releases list for the Mac app. It keeps the ETag and the last result in memory, so a
/// 304 costs no rate limit, and it never throws: a failure keeps the last known result.
public actor UpdateClient {
  private let session: URLSession
  private let url: URL
  private var etag: String?
  private var last: UpdateCheck.Result?

  public init(url: URL = UpdateCheck.releasesURL, protocolClasses: [AnyClass]? = nil) {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 15
    config.urlCache = nil
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.protocolClasses = protocolClasses ?? config.protocolClasses
    session = URLSession(configuration: config, delegate: RefuseRedirects(), delegateQueue: nil)
    self.url = url
  }

  public func check(running: String) async -> UpdateReading {
    var request = URLRequest(url: url)
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    request.setValue("Headroom-Mac/\(running)", forHTTPHeaderField: "User-Agent")
    // Without a result to show, a 304 would leave nothing; ask for the full list instead.
    if let etag, last != nil { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    do {
      let (body, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { return stale() }
      switch http.statusCode {
      case 304 where last != nil: return UpdateReading(result: last, fresh: true)
      case 200:
        guard let result = UpdateCheck.evaluate(releases: body, running: running) else {
          return stale()
        }
        etag = http.value(forHTTPHeaderField: "ETag")
        last = result
        return UpdateReading(result: result, fresh: true)
      default: return stale()
      }
    } catch { return stale() }
  }

  private func stale() -> UpdateReading { UpdateReading(result: last, fresh: false) }
}
