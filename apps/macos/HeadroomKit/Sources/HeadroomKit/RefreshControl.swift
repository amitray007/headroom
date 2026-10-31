import Foundation
import HeadroomAPI
import OpenAPIURLSession

/// Whether this Mac may change a source's Refresh Every. A token gets the `refresh` scope only
/// when the owner switched on "Can Change Refresh Every" while creating it (D44).
public enum RefreshAccess: Sendable, Equatable {
  case allowed
  /// The token reads only, or the server predates the scope.
  case readOnly
  /// The source could not be asked: offline, signed out or unreachable.
  case unknown
}

public protocol RefreshControlling: Sendable {
  func refreshAccess(source: Source, token: String) async -> RefreshAccess
  /// True when the server saved the interval.
  func setRefresh(source: Source, token: String, minutes: Int) async -> Bool
}

/// The Refresh Every choices a server accepts, in minutes.
public enum RefreshInterval {
  public static let options = [2, 5, 10, 15, 30]
}

extension FeedClient: RefreshControlling {
  public func refreshAccess(source: Source, token: String) async -> RefreshAccess {
    guard (try? Source.validate(source.baseURL)) != nil, Self.usable(token) else { return .unknown }
    let client = Client(
      serverURL: source.baseURL,
      transport: URLSessionTransport(configuration: .init(session: session)),
      middlewares: [FeedHeaders(token: token, etag: nil)])
    do {
      switch try await client.getAppWhoami() {
      case .ok(let response):
        // A server from before D44 sends no scopes, so its tokens can only read.
        return try response.body.json.scopes?.contains(.refresh) == true ? .allowed : .readOnly
      default: return .unknown
      }
    } catch { return .unknown }
  }

  public func setRefresh(source: Source, token: String, minutes: Int) async -> Bool {
    guard RefreshInterval.options.contains(minutes), Self.usable(token),
      (try? Source.validate(source.baseURL)) != nil
    else { return false }
    // The generated body type for a number enum is awkward to build, so this one
    // write is a plain request. The session refuses redirects like every other call.
    var request = URLRequest(url: source.baseURL.appending(path: "api/app/v1/settings/refresh"))
    request.httpMethod = "PUT"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data(#"{"refreshIntervalMinutes":\#(minutes)}"#.utf8)
    do {
      let (_, response) = try await session.data(for: request)
      return (response as? HTTPURLResponse)?.statusCode == 200
    } catch { return false }
  }

  private static func usable(_ token: String) -> Bool {
    !token.isEmpty && !token.contains(where: { $0.isNewline })
  }
}
