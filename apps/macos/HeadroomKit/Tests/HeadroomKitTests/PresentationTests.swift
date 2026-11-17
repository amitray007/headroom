import Foundation
import Testing

@testable import HeadroomKit

@Test func duplicateAccountIDsAreIsolatedBySourceForOrderAndVisibility() throws {
  let feed = try fixture()
  let first = try source("https://first.example.invalid")
  let second = try source("https://second.example.invalid")
  let cached = CachedFeed(feed: feed, etag: nil, readAt: Date())
  let snapshots = [
    SourceSnapshot(source: first, state: .connected, cached: cached),
    SourceSnapshot(source: second, state: .connected, cached: cached),
  ]
  let all = Presentation.accounts(snapshots, preferences: DisplayPreferences())
  #expect(Set(all.map(\.id)).count == feed.accounts.count * 2)
  var preferences = DisplayPreferences()
  let firstAccount = try #require(all.first)
  let secondAccount = try #require(all.first { $0.snapshot.id == second.id })
  preferences.hiddenAccounts = [firstAccount.id]
  preferences.accountOrder = [secondAccount.id]
  let visible = Presentation.accounts(snapshots, preferences: preferences)
  #expect(visible.count == all.count - 1)
  #expect(visible.first?.id == secondAccount.id)
  #expect(!visible.contains { $0.id == firstAccount.id })
  #expect(Presentation.needsSource(firstAccount, among: all))
  #expect(!Presentation.needsSource(firstAccount, among: Array(all.prefix(feed.accounts.count))))
  let offline = SourceSnapshot(source: first, state: .offline, cached: cached)
  let alone = Presentation.accounts([offline], preferences: DisplayPreferences())
  #expect(!Presentation.needsSource(try #require(alone.first), among: alone))
}

@Test func bindingPreservesUnknownAndIgnoresSubPools() throws {
  let feed = try fixture()
  let codex = try #require(feed.accounts.first { $0.id == "demo-codex-1" })
  #expect(Presentation.binding(codex)?.percentLeft == 0)
  var unknown = codex
  unknown.limits = codex.limits.filter { $0.percentLeft == nil }
  #expect(Presentation.binding(unknown) == nil)
  let cursor = try #require(feed.accounts.first { $0.provider == .cursor })
  #expect(Presentation.binding(cursor)?.part == false)
}

@Test func preferenceRoundTripKeepsNamespacedIDsAndAppearance() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = DisplayPreferenceStore(directory: directory)
  #expect(try await store.load() == DisplayPreferences())
  var preferences = DisplayPreferences()
  preferences.appearance = .dark
  preferences.itemStyle = .accounts
  preferences.slots = [
    .init(account: "source-a/account-a", look: .ring), .init(look: .bars), .init(), .init(),
  ]
  #expect(preferences.slots.count == DisplayPreferences.maxSlots)
  preferences.providerLogos = false
  preferences.colorLowOut = false
  preferences.liveRoom = true
  preferences.hiddenAccounts = ["source-b/account-a"]
  preferences.accountOrder = ["source-a/account-a", "source-b/account-a"]
  try await store.save(preferences)
  #expect(try await store.load() == preferences)
}

@Test func recoveryLinksStayOnSourceAndUseExistingWebRoutes() throws {
  let configured = try source("https://configured.example.invalid/headroom")
  #expect(
    Presentation.dashboard(configured).absoluteString
      == "https://configured.example.invalid/headroom")
}

@Test func allSeventeenNotificationPreferencesPersistWithoutBannerDelivery() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try NoticeStore(directory: directory)
  #expect(NoticeKind.allCases.count == 17)
  for kind in NoticeKind.allCases { try await store.setEnabled(false, kind: kind) }
  let reloaded = try NoticeStore(directory: directory)
  #expect(await reloaded.enabledKinds().count == 17)
  #expect(await reloaded.enabledKinds().values.allSatisfy { !$0 })
}
