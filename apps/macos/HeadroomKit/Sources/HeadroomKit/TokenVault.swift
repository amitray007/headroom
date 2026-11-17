import Foundation
import Security

public protocol TokenVault: Sendable {
  func token(for sourceID: UUID) async throws -> String?
  func setToken(_ token: String?, for sourceID: UUID) async throws
}

public actor KeychainTokenVault: TokenVault {
  public static let service = "club.theblank.headroom.mac"
  private let item: any KeychainItemAccess

  public init() { item = SystemKeychainItem() }
  init(item: any KeychainItemAccess) { self.item = item }

  public func token(for sourceID: UUID) throws -> String? { try read()[sourceID.uuidString] }

  public func setToken(_ token: String?, for sourceID: UUID) throws {
    var tokens = try read()
    tokens[sourceID.uuidString] = token
    try item.write(JSONEncoder().encode(tokens))
  }

  private func read() throws -> [String: String] {
    guard let data = try item.read() else { return [:] }
    return try JSONDecoder().decode([String: String].self, from: data)
  }
}

protocol KeychainItemAccess: Sendable {
  func read() throws -> Data?
  func write(_ data: Data) throws
}

private struct SystemKeychainItem: KeychainItemAccess {
  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: KeychainTokenVault.service,
      kSecAttrAccount as String: "source-tokens",
    ]
  }

  func write(_ data: Data) throws {
    let status = SecItemUpdate(
      query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      try check(SecItemAdd(item as CFDictionary, nil))
    } else {
      try check(status)
    }
  }

  func read() throws -> Data? {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    try check(status)
    guard let data = result as? Data else { throw VaultError.invalidData }
    return data
  }

  private func check(_ status: OSStatus) throws {
    guard status == errSecSuccess else { throw VaultError.keychain(status) }
  }
}

public enum VaultError: Error {
  case keychain(OSStatus)
  case invalidData
}

public actor InMemoryTokenVault: TokenVault {
  private var tokens: [UUID: String] = [:]
  public init() {}
  public func token(for sourceID: UUID) -> String? { tokens[sourceID] }
  public func setToken(_ token: String?, for sourceID: UUID) { tokens[sourceID] = token }
}
