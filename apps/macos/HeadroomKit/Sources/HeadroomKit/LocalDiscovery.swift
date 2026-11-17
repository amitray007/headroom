import Foundation

/// The server picks its port itself: the one it used last, 8080 for installs from before that, then
/// the first free one from 4323. The app finds it by asking each candidate for its health check.
extension LocalServer {
  public static let candidatePorts = Array(4323...4342) + [8080]

  public static func url(port: Int) -> URL { URL(string: "http://127.0.0.1:\(port)")! }

  /// The first candidate, where a server that was never found would start.
  public static var defaultURL: URL { url(port: candidatePorts[0]) }

  public static func port(of url: URL) -> Int? {
    guard url.scheme == "http", url.host() == "127.0.0.1", url.path.isEmpty || url.path == "/",
      let port = url.port, candidatePorts.contains(port)
    else { return nil }
    return port
  }

  public static func isThisMac(_ url: URL) -> Bool { port(of: url) != nil }

  /// The port to use among those that answered: the preferred one when it answers, else the first
  /// candidate that does.
  static func choose(answering: Set<Int>, preferred: Int?) -> Int? {
    if let preferred, answering.contains(preferred) { return preferred }
    return candidatePorts.first(where: answering.contains)
  }

  /// A Headroom that answered its health check on this Mac.
  public struct Found: Sendable, Equatable {
    public let url: URL
    public let version: String?
  }
}

extension FeedClient {
  /// Asks every candidate port at once and returns the server to use. `preferring` is the
  /// current This Mac source's URL, so a second Headroom on another port never takes its place.
  public func discoverThisMac(preferring current: URL? = nil) async -> LocalServer.Found? {
    let answers = await withTaskGroup(of: (Int, Health?).self) { group in
      for port in LocalServer.candidatePorts {
        group.addTask { (port, await self.health(LocalServer.url(port: port), timeout: 1)) }
      }
      var answers: [Int: Health] = [:]
      for await (port, health) in group where health?.status == "ok" { answers[port] = health }
      return answers
    }
    guard
      let port = LocalServer.choose(
        answering: Set(answers.keys), preferred: current.flatMap(LocalServer.port(of:)))
    else { return nil }
    return LocalServer.Found(url: LocalServer.url(port: port), version: answers[port]?.version)
  }
}
