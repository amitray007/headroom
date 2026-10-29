import Foundation
import HeadroomAPI
import OpenAPIURLSession

public enum SourceSetupError: Error, Equatable, LocalizedError {
  case nameRequired, tokenRequired, rejectedToken, needsUpdate, unavailable, busy

  public var errorDescription: String? {
    switch self {
    case .busy: "Another source change is in progress. Try again when it finishes."
    case .nameRequired: "Enter a source name."
    case .tokenRequired: "Paste a read-only token from this source's dashboard."
    case .rejectedToken:
      "This token was not accepted. Create a token in the source's Devices settings."
    case .needsUpdate: "Update this server to use the Mac app."
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
        guard try response.body.json.apiVersion == 1 else { throw SourceSetupError.needsUpdate }
      case .unauthorized: throw SourceSetupError.rejectedToken
      case .undocumented(statusCode: 404, _): throw SourceSetupError.needsUpdate
      default: throw SourceSetupError.unavailable
      }
    } catch let error as SourceSetupError { throw error } catch {
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
