import Darwin
import Foundation

public struct Source: Identifiable, Codable, Hashable, Sendable {
  public let id: UUID
  public var name: String
  public let baseURL: URL

  public init(id: UUID = UUID(), name: String, baseURL: URL) throws {
    try Self.validate(baseURL)
    guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
      throw SourceError.invalidURL
    }
    while components.percentEncodedPath.hasSuffix("/") {
      components.percentEncodedPath.removeLast()
    }
    guard let normalized = components.url else { throw SourceError.invalidURL }
    self.id = id
    self.name = name
    self.baseURL = normalized
  }

  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(
      id: values.decode(UUID.self, forKey: .id),
      name: values.decode(String.self, forKey: .name),
      baseURL: values.decode(URL.self, forKey: .baseURL)
    )
  }

  public static func validate(_ url: URL) throws {
    guard let host = url.host, !host.isEmpty,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
      url.port.map({ (1...65535).contains($0) }) ?? true
    else { throw SourceError.invalidURL }
    if url.scheme == "https" { return }
    guard url.scheme == "http", isLocal(host) else { throw SourceError.insecureURL }
  }

  private static func isLocal(_ host: String) -> Bool {
    let host = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    // mDNS names stay on the LAN.
    if host == "localhost" || host.hasSuffix(".local") { return true }
    var ipv4 = in_addr()
    if inet_pton(AF_INET, host, &ipv4) == 1 {
      let n = UInt32(bigEndian: ipv4.s_addr)
      // 100.64.0.0/10 is shared address space; Tailscale gives tailnet nodes addresses there.
      return n >> 24 == 127 || n >> 24 == 10 || n >> 20 == 0xAC1 || n >> 16 == 0xC0A8
        || n >> 16 == 0xA9FE || n >> 22 == 0x191
    }
    var ipv6 = in6_addr()
    if inet_pton(AF_INET6, host, &ipv6) == 1 {
      let bytes = withUnsafeBytes(of: &ipv6) { Array($0) }
      let loopback = bytes.dropLast().allSatisfy { $0 == 0 } && bytes.last == 1
      let privateLAN = bytes[0] & 0xFE == 0xFC
      let linkLocal = bytes[0] == 0xFE && bytes[1] & 0xC0 == 0x80
      let mappedIPv4 =
        bytes.prefix(10).allSatisfy { $0 == 0 } && bytes[10] == 0xFF && bytes[11] == 0xFF
      let localMapped =
        mappedIPv4
        && (bytes[12] == 127 || bytes[12] == 10
          || (bytes[12] == 172 && (16...31).contains(bytes[13]))
          || (bytes[12] == 192 && bytes[13] == 168) || (bytes[12] == 169 && bytes[13] == 254))
      return loopback || privateLAN || linkLocal || localMapped
    }
    return false
  }
}

public enum SourceError: Error, Equatable {
  case invalidURL
  case insecureURL
  case duplicateID
}

public enum SourceState: String, Codable, Sendable, CaseIterable {
  case connected, offline, signedOut, needsUpdate, noData
}
