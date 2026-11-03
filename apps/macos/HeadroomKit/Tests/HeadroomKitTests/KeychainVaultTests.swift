import Foundation
import Synchronization
import Testing

@testable import HeadroomKit

private final class MemoryKeychainItem: KeychainItemAccess {
  let data = Mutex<Data?>(nil)
  func read() -> Data? { data.withLock { $0 } }
  func write(_ value: Data) { data.withLock { $0 = value } }
}

@Test func keychainVaultStoresEverySourceInOneJSONItem() async throws {
  let item = MemoryKeychainItem()
  let vault = KeychainTokenVault(item: item)
  let a = UUID()
  let b = UUID()
  #expect(try await vault.token(for: a) == nil)
  try await vault.setToken("synthetic-a", for: a)
  try await vault.setToken("synthetic-b", for: b)
  let data = try #require(item.read())
  #expect(
    try JSONDecoder().decode([String: String].self, from: data) == [
      a.uuidString: "synthetic-a", b.uuidString: "synthetic-b",
    ])
  let reopened = KeychainTokenVault(item: item)
  #expect(try await reopened.token(for: a) == "synthetic-a")
  try await reopened.setToken(nil, for: a)
  #expect(try await reopened.token(for: a) == nil)
  #expect(try await reopened.token(for: b) == "synthetic-b")
}

@Test func malformedKeychainDataIsNotOverwritten() async throws {
  let item = MemoryKeychainItem()
  item.write(Data("invalid JSON".utf8))
  let vault = KeychainTokenVault(item: item)
  await #expect(throws: (any Error).self) { try await vault.setToken("synthetic", for: UUID()) }
  #expect(item.read() == Data("invalid JSON".utf8))
}
