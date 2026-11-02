import Foundation
import HeadroomAPI
import OpenAPIRuntime
import OpenAPIURLSession

public enum SourceSetupError: Error, Equatable, LocalizedError {
  case nameRequired, tokenRequired, rejectedToken, unavailable, busy
  /// The server is older than this build reads, with the version it reports when it says.
  case needsUpdate(version: String?)
  /// The server is newer than this build reads.
  case appOutdated(version: String?)

  public var errorDescription: String? {
    switch self {
    case .busy: "Another source change is in progress. Try again when it finishes."
    case .nameRequired: "Enter a source name."
    case .tokenRequired: "Paste a read-only token from this source's dashboard."
    case .rejectedToken:
      "This token was not accepted. Create a token in the source's Devices settings."
    case .needsUpdate(let version?):
      "This server runs Headroom \(version). Headroom for Mac needs \(ServerCompatibility.minimumServer) or later. Update the server, then verify again."
    case .needsUpdate(nil):
      "This server runs a Headroom version older than \(ServerCompatibility.minimumServer), which Headroom for Mac needs. Update the server, then verify again."
    case .appOutdated(let version?):
      "This server runs Headroom \(version), newer than this app can read. Update Headroom for Mac, then verify again."
    case .appOutdated(nil):
      "This server runs a newer Headroom than this app can read. Update Headroom for Mac, then verify again."
    case .unavailable: "Could not reach this source. Check the URL and try again."
    }
  }
}

public protocol SourceVerifying: Sendable {
  func verify(source: Source, token: String) async throws
}

extension FeedClient: SourceVerifying {
  public func verify(source: Source, token: String) async throws {
    try Source.validate(source.baseURL)
    guard !token.isEmpty, !token.contains(where: { $0.isNewline }) else {
      throw SourceSetupError.tokenRequired
    }
    let client = Client(
      serverURL: source.baseURL,
      transport: URLSessionTransport(configuration: .init(session: session)),
      middlewares: [FeedHeaders(token: token, etag: nil)])
    do {
      switch try await client.getAppWhoami() {
      case .ok(let response):
        let whoami = try response.body.json
        guard whoami.apiVersion == 1 else {
          throw whoami.apiVersion > 1
            ? SourceSetupError.appOutdated(version: whoami.serverVersion)
            : SourceSetupError.needsUpdate(version: whoami.serverVersion)
        }
      case .unauthorized: throw SourceSetupError.rejectedToken
      case .undocumented(statusCode: 404, _):
        throw SourceSetupError.needsUpdate(version: await reportedVersion(source))
      default: throw SourceSetupError.unavailable
      }
    } catch let error as SourceSetupError { throw error } catch let error as ClientError
      where Self.wrongShape(error.underlyingError)
    {
      let version = await reportedVersion(source)
      guard let decoding = error.underlyingError as? DecodingError,
        ServerCompatibility.side(of: decoding) == .appOutdated
      else { throw SourceSetupError.needsUpdate(version: version) }
      throw SourceSetupError.appOutdated(version: version)
    } catch {
      throw SourceSetupError.unavailable
    }
  }

  public func thisMacAvailable() async -> Bool {
    guard let url = URL(string: "http://127.0.0.1:8080/healthz") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 2
    do {
      let (_, response) = try await session.data(for: request)
      return (response as? HTTPURLResponse)?.statusCode == 200
    } catch { return false }
  }
}

/// Verification happens before either store changes. A changed URL requires a new token so an
/// existing credential is never sent to a different server during editing.
public actor SourceSetup {
  private let store: SourceStore
  private let vault: any TokenVault
  private let verifier: any SourceVerifying

  public init(
    store: SourceStore, vault: any TokenVault, verifier: any SourceVerifying = FeedClient()
  ) {
    self.store = store
    self.vault = vault
    self.verifier = verifier
  }

  public func save(id: UUID?, name: String, url: String, token: String) async throws -> [Source] {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw SourceSetupError.nameRequired }
    guard let baseURL = URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      throw SourceError.invalidURL
    }
    let source = try Source(id: id ?? UUID(), name: name, baseURL: baseURL)
    var sources = try await store.load()
    let existing = sources.first { $0.id == source.id }
    let previous = try await vault.token(for: source.id)
    let pasted = token.trimmingCharacters(in: .whitespacesAndNewlines)
    let effectiveToken = pasted.isEmpty && existing?.baseURL == source.baseURL ? previous : pasted
    guard let effectiveToken, !effectiveToken.isEmpty else { throw SourceSetupError.tokenRequired }
    try await verifier.verify(source: source, token: effectiveToken)
    try await vault.setToken(effectiveToken, for: source.id)
    if let index = sources.firstIndex(where: { $0.id == source.id }) {
      sources[index] = source
    } else {
      sources.append(source)
    }
    do { try await store.save(sources) } catch {
      try await vault.setToken(previous, for: source.id)
      throw error
    }
    return sources
  }
}
