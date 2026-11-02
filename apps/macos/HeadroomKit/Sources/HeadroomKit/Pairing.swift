import Foundation
import HeadroomAPI
import OpenAPIRuntime
import OpenAPIURLSession

/// A pairing the server started: the short code to show, and the secret the app polls with.
public struct PairingCode: Sendable, Equatable {
  public let code: String
  public let deviceCode: String
  /// Seconds the pairing lives, and seconds between two polls.
  public let expiresIn: Int
  public let interval: Int

  public init(code: String, deviceCode: String, expiresIn: Int, interval: Int) {
    self.code = code
    self.deviceCode = deviceCode
    self.expiresIn = expiresIn
    self.interval = interval
  }
}

public enum PairingStatus: Sendable, Equatable {
  case pending, denied, expired
  /// The read-only token, sent once.
  case approved(token: String)
}

public enum PairingOutcome: Sendable, Equatable {
  case approved(token: String)
  case denied, expired
  /// The server predates pairing: offer the token form.
  case serverTooOld
}

public enum PairingError: Error, Equatable, LocalizedError {
  case unavailable
  public var errorDescription: String? { "Could not reach this server. Check the address." }
}

/// The two pairing requests. A stub replaces it in tests.
public protocol PairingTransport: Sendable {
  /// Nil when the server has no pairing endpoint (404).
  func start(baseURL: URL, name: String) async throws -> PairingCode?
  /// `.expired` for an unknown or already claimed device code (404).
  func status(baseURL: URL, deviceCode: String) async throws -> PairingStatus
}

public enum Pairing {
  /// The name the server lists the device under, at most 40 characters.
  public static func deviceName(macName: String) -> String {
    String("Headroom for Mac · \(macName)".prefix(40))
  }

  /// The page the owner approves on.
  public static func approvalPage(baseURL: URL, code: String) -> URL? {
    URL(string: baseURL.absoluteString + "/#/pair/" + code)
  }

  /// The dashboard page that connects AI accounts.
  public static func connectPage(baseURL: URL) -> URL? {
    URL(string: baseURL.absoluteString + "/#/connect")
  }

  /// Polls failing this many times in a row end the wait.
  static let patience = 5

  /// Starts a pairing, hands the code over, then polls until the owner answers or the pairing
  /// ends. Cancelling the task stops the loop. `sleep` is injected so tests do not wait.
  public static func run(
    baseURL: URL, name: String, transport: some PairingTransport,
    onCode: @Sendable (PairingCode) -> Void,
    sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) async throws -> PairingOutcome {
    guard let pairing = try await transport.start(baseURL: baseURL, name: name) else {
      return .serverTooOld
    }
    onCode(pairing)
    var waited = 0
    var failures = 0
    while waited < pairing.expiresIn {
      try await sleep(.seconds(pairing.interval))
      waited += pairing.interval
      try Task.checkCancellation()
      do {
        switch try await transport.status(baseURL: baseURL, deviceCode: pairing.deviceCode) {
        case .approved(let token): return .approved(token: token)
        case .denied: return .denied
        case .expired: return .expired
        case .pending: failures = 0
        }
      } catch is CancellationError {
        throw CancellationError()
      } catch {
        failures += 1
        if failures >= patience { throw PairingError.unavailable }
      }
    }
    return .expired
  }
}

extension FeedClient: PairingTransport {
  public func start(baseURL: URL, name: String) async throws -> PairingCode? {
    try Source.validate(baseURL)
    let client = pairingClient(baseURL)
    do {
      switch try await client.postAppPair(body: .json(.init(name: name))) {
      case .ok(let response):
        let body = try response.body.json
        return PairingCode(
          code: body.code, deviceCode: body.deviceCode, expiresIn: body.expiresIn,
          interval: body.interval)
      case .notFound: return nil
      default: throw PairingError.unavailable
      }
    } catch let error as PairingError {
      throw error
    } catch let error as ClientError where error.response?.status.code == 404 {
      // An older server answers 404 in its own shape, which the generated client cannot decode.
      return nil
    } catch {
      throw PairingError.unavailable
    }
  }

  public func status(baseURL: URL, deviceCode: String) async throws -> PairingStatus {
    let client = pairingClient(baseURL)
    do {
      switch try await client.postAppPairToken(body: .json(.init(deviceCode: deviceCode))) {
      case .ok(let response):
        let body = try response.body.json
        switch body.status {
        case .pending: return .pending
        case .denied: return .denied
        case .expired: return .expired
        case .approved:
          guard let token = body.token, !token.isEmpty else { throw PairingError.unavailable }
          return .approved(token: token)
        }
      case .notFound: return .expired
      default: throw PairingError.unavailable
      }
    } catch let error as PairingError {
      throw error
    } catch let error as ClientError where error.response?.status.code == 404 {
      return .expired
    } catch {
      throw PairingError.unavailable
    }
  }

  /// Neither request carries a token: the owner's approval is what grants one.
  private func pairingClient(_ baseURL: URL) -> Client {
    Client(
      serverURL: baseURL, transport: URLSessionTransport(configuration: .init(session: session)))
  }
}
