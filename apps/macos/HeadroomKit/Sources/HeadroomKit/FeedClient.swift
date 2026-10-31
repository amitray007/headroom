import Foundation
import HTTPTypes
import HeadroomAPI
import OpenAPIRuntime
import OpenAPIURLSession

public enum FeedRead: Sendable {
  case updated(AppFeed, etag: String?)
  case notModified(etag: String?)
  case failed(SourceState)
}

public protocol FeedReading: Sendable {
  func read(source: Source, token: String, etag: String?) async -> FeedRead
}

public struct FeedClient: FeedReading, Sendable {
  let session: URLSession
  private let timeZone: @Sendable () -> TimeZone
  private let now: @Sendable () -> Date

  public init(
    protocolClasses: [AnyClass]? = nil,
    timeZone: @escaping @Sendable () -> TimeZone = { .current },
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 15
    config.urlCache = nil
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.protocolClasses = protocolClasses ?? config.protocolClasses
    session = URLSession(configuration: config, delegate: RefuseRedirects(), delegateQueue: nil)
    self.timeZone = timeZone
    self.now = now
  }

  public func read(source: Source, token: String, etag: String?) async -> FeedRead {
    do {
      try Source.validate(source.baseURL)
      guard !token.isEmpty, !token.contains(where: { $0.isNewline }) else {
        return .failed(.signedOut)
      }
      let client = Client(
        serverURL: source.baseURL,
        transport: URLSessionTransport(configuration: .init(session: session)),
        middlewares: [FeedHeaders(token: token, etag: etag)]
      )
      let response = try await client.getAppFeed(
        query: .init(tz: timeZone().secondsFromGMT(for: now()) / 60),
        headers: .init(If_hyphen_None_hyphen_Match: etag)
      )
      switch response {
      case .ok(let result):
        let feed = try result.body.json
        guard feed.apiVersion == 1 else { return .failed(.needsUpdate) }
        return .updated(feed, etag: result.headers.ETag)
      case .notModified(let result): return .notModified(etag: result.headers.ETag)
      case .unauthorized: return .failed(.signedOut)
      case .undocumented(statusCode: 404, _): return .failed(.needsUpdate)
      default: return .failed(.offline)
      }
    } catch { return .failed(.offline) }
  }
}

private struct FeedHeaders: ClientMiddleware {
  let token: String
  let etag: String?

  func intercept(
    _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    request.headerFields[.authorization] = "Bearer \(token)"
    // ETags are opaque HTTP validators. The generated URI header encoder escapes their quotes.
    request.headerFields[.ifNoneMatch] = etag.flatMap { $0.contains(where: \.isNewline) ? nil : $0 }
    return try await next(request, body, baseURL)
  }
}

final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
