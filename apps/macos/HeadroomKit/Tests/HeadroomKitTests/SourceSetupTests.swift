import Foundation
import Testing

@testable import HeadroomKit

private actor VerificationSpy: SourceVerifying {
  var calls: [(Source, String)] = []
  var reject = false
  func setReject() { reject = true }
  func verify(source: Source, token: String) throws {
    calls.append((source, token))
    if reject { throw SourceSetupError.rejectedToken }
  }
  func count() -> Int { calls.count }
  func lastToken() -> String? { calls.last?.1 }
}

@Test func rejectedSourceDoesNotSaveSourceOrToken() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = SourceStore(directory: directory)
  let vault = InMemoryTokenVault()
  let verifier = VerificationSpy()
  await verifier.setReject()
  let setup = SourceSetup(store: store, vault: vault, verifier: verifier)
  await #expect(throws: SourceSetupError.rejectedToken) {
    try await setup.save(
      id: nil, name: "Synthetic", url: "https://test.example.invalid", token: "synthetic-rejected")
  }
  #expect(try await store.load().isEmpty)
  #expect(await verifier.count() == 1)
  let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
  #expect(files.isEmpty)
}

@Test func sourceSaveVerifiesAndKeepsTokenOnlyInVault() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = SourceStore(directory: directory)
  let vault = InMemoryTokenVault()
  let verifier = VerificationSpy()
  let setup = SourceSetup(store: store, vault: vault, verifier: verifier)
  let saved = try await setup.save(
    id: nil, name: " Synthetic ", url: "https://test.example.invalid/", token: " synthetic-token ")
  let source = try #require(saved.first)
  #expect(source.name == "Synthetic")
  #expect(source.baseURL.absoluteString == "https://test.example.invalid")
  #expect(await verifier.lastToken() == "synthetic-token")
  #expect(try await vault.token(for: source.id) == "synthetic-token")
  let data = try String(contentsOf: directory.appending(path: "sources.json"), encoding: .utf8)
  #expect(!data.contains("synthetic-token"))
  let renamed = try await setup.save(
    id: source.id, name: "Renamed", url: source.baseURL.absoluteString, token: "")
  #expect(renamed.count == 1)
  #expect(renamed.first?.id == source.id)
  #expect(renamed.first?.name == "Renamed")
  #expect(await verifier.count() == 2)
}

@Test func editingURLCannotSendSavedTokenToNewServer() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = SourceStore(directory: directory)
  let vault = InMemoryTokenVault()
  let verifier = VerificationSpy()
  let old = try source()
  try await store.save([old])
  await vault.setToken("synthetic-old", for: old.id)
  let setup = SourceSetup(store: store, vault: vault, verifier: verifier)
  await #expect(throws: SourceSetupError.tokenRequired) {
    try await setup.save(id: old.id, name: old.name, url: "https://new.example.invalid", token: "")
  }
  #expect(await verifier.count() == 0)
  #expect(try await store.load() == [old])
  #expect(await vault.token(for: old.id) == "synthetic-old")
  let saved = try await setup.save(
    id: old.id, name: old.name, url: "https://new.example.invalid", token: "synthetic-new")
  #expect(saved.first?.baseURL.host == "new.example.invalid")
  #expect(await vault.token(for: old.id) == "synthetic-new")
  #expect(await verifier.lastToken() == "synthetic-new")
}

@Test func rejectedEditPreservesExistingTokenAndSource() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = SourceStore(directory: directory)
  let vault = InMemoryTokenVault()
  let verifier = VerificationSpy()
  let old = try source()
  try await store.save([old])
  await vault.setToken("synthetic-old", for: old.id)
  await verifier.setReject()
  let setup = SourceSetup(store: store, vault: vault, verifier: verifier)
  await #expect(throws: SourceSetupError.rejectedToken) {
    try await setup.save(
      id: old.id, name: "Edited", url: old.baseURL.absoluteString, token: "synthetic-rejected")
  }
  #expect(try await store.load() == [old])
  #expect(await vault.token(for: old.id) == "synthetic-old")
}

@Test func invalidSourceIsRejectedBeforeVerification() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let verifier = VerificationSpy()
  let setup = SourceSetup(
    store: SourceStore(directory: directory), vault: InMemoryTokenVault(), verifier: verifier)
  await #expect(throws: SourceSetupError.nameRequired) {
    try await setup.save(
      id: nil, name: "  ", url: "https://test.example.invalid", token: "synthetic")
  }
  await #expect(throws: SourceError.insecureURL) {
    try await setup.save(
      id: nil, name: "Synthetic", url: "http://public.example.invalid", token: "synthetic")
  }
  #expect(await verifier.count() == 0)
}
