import Foundation
import Testing

@testable import HeadroomKit

// All data here is synthetic. Room left: Alpha 50, Bravo 15 (tight), Charlie 80, Delta 0 (out),
// Echo 60 with a projected run-out. Tightest order: Echo, Bravo, Alpha, Charlie.

private let now = Date(timeIntervalSince1970: 1_793_286_000)
private let nowMs = 1_793_286_000_000

private typealias Slot = DisplayPreferences.MenuSlot

private func account(
  _ id: String, _ provider: FeedAccount.providerPayload, left: Double?,
  session: Double? = nil, runsOutInHours: Double? = nil,
  state: FeedAccount.statePayload = .ready
) throws -> FeedAccount {
  var account = try #require(try fixture().accounts.first { $0.id == "demo-codex-2" })
  var template = try #require(account.limits.first)
  template.part = false
  template.unlimited = false
  template.notStarted = false
  template.resetsAt = nowMs + 20 * 3_600_000
  template.runsOutAt = nil
  var limits: [FeedAccount.limitsPayloadPayload] = []
  if let session {
    var limit = template
    limit.key = "\(id).session"
    limit.label = "Session"
    limit.windowKind = .session
    limit.percentLeft = session
    limits.append(limit)
  }
  var weekly = template
  weekly.key = "\(id).weekly"
  weekly.label = "Weekly"
  weekly.windowKind = .weekly
  weekly.percentLeft = left
  if let runsOutInHours {
    weekly.runsOutAt = nowMs + Int(runsOutInHours * 3_600_000)
    weekly.resetsAt = nowMs + 10 * 3_600_000
  }
  if left != nil || session == nil { limits.append(weekly) }
  account.id = id
  account.provider = provider
  account.name = id.capitalized
  account.state = state
  account.limits = limits
  return account
}

private func items(
  _ accounts: [FeedAccount], state: SourceState = .connected
) throws -> [AccountItem] {
  let snapshot = SourceSnapshot(source: try source(), state: state)
  return accounts.map { AccountItem(snapshot: snapshot, account: $0) }
}

private struct World {
  let alpha: AccountItem
  let bravo: AccountItem
  let charlie: AccountItem
  let delta: AccountItem
  let echo: AccountItem
  var all: [AccountItem] { [alpha, bravo, charlie, delta, echo] }
  /// Everything with room, no out account.
  var healthy: [AccountItem] { [alpha, bravo, charlie, echo] }

  init() throws {
    let list = try items([
      account("alpha", .claude, left: 50),
      account("bravo", .codex, left: 15),
      account("charlie", .cursor, left: 80),
      account("delta", .grok, left: 0),
      account("echo", .copilot, left: 60, runsOutInHours: 1),
    ])
    (alpha, bravo, charlie, delta, echo) = (list[0], list[1], list[2], list[3], list[4])
  }
}

private func preferences(
  slots: [Slot] = [Slot()], logos: Bool = true, colors: Bool = true, liveRoom: Bool = false,
  view: DisplayPreferences.LimitsView = .left
) -> DisplayPreferences {
  var value = DisplayPreferences()
  value.slots = slots
  value.providerLogos = logos
  value.colorLowOut = colors
  value.liveRoom = liveRoom
  value.limitsView = view
  return value
}

private func status(
  _ style: DisplayPreferences.ItemStyle, _ preferences: DisplayPreferences = preferences(),
  visible: [AccountItem], all: [AccountItem]? = nil, sources: [SourceState] = [.connected],
  ready: Bool = true, unread: Int = 0, sample: Bool = false
) -> MenuStatus {
  MenuStatus(
    style: style, preferences: preferences, visible: visible, all: all ?? visible,
    sources: sources, ready: ready, unread: unread, now: now, sample: sample)
}

private func names(_ status: MenuStatus) -> [String] { status.readings.map(\.name) }

private let threeTightest = [Slot(), Slot(), Slot()]

// MARK: Slot selection by style

@Test func logoShowsNoSlotsAndNoText() throws {
  let world = try World()
  let result = status(.logo, preferences(slots: threeTightest), visible: world.healthy)
  #expect(result.readings.isEmpty)
  #expect(result.text == nil)
  #expect(result.textTone == .plain)
  #expect(result.liveRoom == nil)
  #expect(result.tooltip == "Headroom")
  #expect(result.summary == "Headroom")
  #expect(result.dot == nil)
}

@Test func logoAndRoomUsesOnlyTheFirstSlot() throws {
  let world = try World()
  let result = status(.logoAndRoom, preferences(slots: threeTightest), visible: world.healthy)
  #expect(result.readings.isEmpty)
  #expect(result.text == "60% left")
  #expect(result.textTone == .low)
}

@Test func logoAndRoomFollowsAPinnedFirstSlot() throws {
  let world = try World()
  let pinned = preferences(slots: [Slot(account: world.charlie.id), Slot(), Slot()])
  let result = status(.logoAndRoom, pinned, visible: world.healthy)
  #expect(result.text == "80% left")
  #expect(result.textTone == .plain)
  #expect(result.tooltip == "Headroom\nCursor Charlie: 80% left")
  #expect(result.summary == "Headroom, Cursor Charlie, 80% left")
}

@Test(arguments: [DisplayPreferences.ItemStyle.liveLogo, .dots, .accounts])
func slotStylesShowEverySlot(style: DisplayPreferences.ItemStyle) throws {
  let world = try World()
  let result = status(style, preferences(slots: threeTightest), visible: world.healthy)
  #expect(names(result) == ["Copilot Echo", "Codex Bravo", "Claude Alpha"])
  #expect(result.text == nil)
}

@Test func slotsBeyondTheSlotCountAreNotShown() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: [Slot(), Slot()]), visible: world.healthy)
  #expect(names(result) == ["Copilot Echo", "Codex Bravo"])
}

// MARK: Tightest

@Test func tightestSlotsPickDistinctAccountsInRankOrder() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: threeTightest), visible: world.healthy)
  // Echo has a projected run-out, so it ranks before Bravo with less room.
  #expect(result.readings.map(\.left) == [60, 15, 50])
  #expect(Set(names(result)).count == 3)
}

@Test func projectedRunOutOutranksLowerRoom() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: [Slot()]), visible: [world.bravo, world.echo])
  #expect(names(result) == ["Copilot Echo"])
}

@Test func lessRoomRanksFirstWithoutAProjection() throws {
  let world = try World()
  let result = status(
    .accounts, preferences(slots: [Slot(), Slot()]),
    visible: [world.charlie, world.alpha])
  #expect(names(result) == ["Claude Alpha", "Cursor Charlie"])
}

@Test func aPinnedAccountIsNeverRepeatedByATightestSlot() throws {
  let world = try World()
  // Echo is the tightest, but the second slot pins it, so the first slot takes Bravo.
  let pinned = preferences(slots: [Slot(), Slot(account: world.echo.id), Slot()])
  let result = status(.accounts, pinned, visible: world.healthy)
  #expect(names(result) == ["Codex Bravo", "Copilot Echo", "Claude Alpha"])
}

@Test func pinnedFirstThenTightestSkipsThePinned() throws {
  let world = try World()
  let pinned = preferences(slots: [Slot(account: world.bravo.id), Slot(), Slot()])
  let result = status(.accounts, pinned, visible: world.healthy)
  #expect(names(result) == ["Codex Bravo", "Copilot Echo", "Claude Alpha"])
}

@Test func twoSlotsPinningTheSameAccountBothShowIt() throws {
  let world = try World()
  let pinned = preferences(slots: [Slot(account: world.alpha.id), Slot(account: world.alpha.id)])
  let result = status(.accounts, pinned, visible: world.healthy)
  #expect(names(result) == ["Claude Alpha", "Claude Alpha"])
}

@Test func aPinnedHiddenAccountStillShows() throws {
  let world = try World()
  let pinned = preferences(slots: [Slot(account: world.delta.id), Slot()])
  let visible = world.healthy
  let result = status(.accounts, pinned, visible: visible, all: world.all)
  #expect(names(result) == ["Grok Delta", "Copilot Echo"])
  #expect(result.readings.first?.text == "Out")
}

@Test func aPinnedRemovedAccountDrops() throws {
  let world = try World()
  let pinned = preferences(slots: [Slot(account: "removed/account"), Slot()])
  let result = status(.accounts, pinned, visible: world.healthy, all: world.healthy)
  #expect(names(result) == ["Copilot Echo"])
}

@Test func theAccountListIsReadOnlyWhenASlotPinsOne() throws {
  let world = try World()
  var reads = 0
  func counted() -> [AccountItem] {
    reads += 1
    return world.all
  }
  _ = MenuStatus(
    style: .accounts, preferences: preferences(slots: threeTightest), visible: world.healthy,
    all: counted(), sources: [.connected], ready: true, unread: 0, now: now)
  #expect(reads == 0)
  _ = MenuStatus(
    style: .accounts, preferences: preferences(slots: [Slot(account: world.alpha.id)]),
    visible: world.healthy, all: counted(), sources: [.connected], ready: true, unread: 0,
    now: now)
  #expect(reads == 1)
}

@Test func tightestSkipsNonConnectedSources() throws {
  let world = try World()
  let kept = try items([account("kept", .claude, left: 5)], state: .offline)
  let result = status(
    .accounts, preferences(slots: [Slot(), Slot()]), visible: kept + [world.alpha, world.charlie],
    sources: [.connected, .offline])
  #expect(names(result) == ["Claude Alpha", "Cursor Charlie"])
}

@Test func tightestSkipsSignedOutAccountsAndAccountsWithoutAFigure() throws {
  let list = try items([
    account("reconnect", .claude, left: 5, state: .reconnect_required),
    account("blank", .codex, left: nil),
    account("fine", .cursor, left: 70),
  ])
  let result = status(.accounts, preferences(slots: threeTightest), visible: list)
  #expect(names(result) == ["Cursor Fine"])
}

@Test func tightestSkipsOutAccountsWhileAnotherHasRoom() throws {
  let world = try World()
  let result = status(
    .accounts, preferences(slots: [Slot()]), visible: [world.delta, world.charlie])
  #expect(names(result) == ["Cursor Charlie"])
}

@Test func tightestFallsBackToAnOutAccountWhenNoneHasRoom() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: [Slot()]), visible: [world.delta])
  #expect(names(result) == ["Grok Delta"])
  #expect(result.readings.first?.text == "Out")
  #expect(result.readings.first?.tone == .out)
}

@Test func anOutAccountFillsASlotAfterTheAccountsWithRoom() throws {
  let world = try World()
  let result = status(
    .accounts, preferences(slots: threeTightest),
    visible: [world.alpha, world.delta, world.charlie])
  #expect(names(result) == ["Claude Alpha", "Cursor Charlie", "Grok Delta"])
}

@Test func outFallbacksFillSlotsInOrderWithoutRepeating() throws {
  let list = try items([account("one", .grok, left: 0), account("two", .codex, left: 0)])
  let result = status(.accounts, preferences(slots: [Slot(), Slot()]), visible: list)
  #expect(names(result) == ["Grok One", "Codex Two"])
}

// MARK: Logo and room fallback chain

@Test func logoAndRoomSignInNeededShowsBang() throws {
  let signedOut = try items([account("gone", .claude, left: 30)], state: .signedOut)
  let result = status(.logoAndRoom, visible: signedOut, sources: [.signedOut])
  #expect(result.text == "!")
  #expect(result.textTone == .out)
}

@Test func logoAndRoomReconnectRequiredShowsBang() throws {
  let list = try items([account("gone", .claude, left: 30, state: .reconnect_required)])
  let result = status(.logoAndRoom, visible: list)
  #expect(result.text == "!")
  #expect(result.textTone == .out)
}

@Test func logoAndRoomOutAccountOnAnOfflineSourceShowsOut() throws {
  let offline = try items([account("zero", .claude, left: 0)], state: .offline)
  let result = status(.logoAndRoom, visible: offline, sources: [.offline])
  #expect(result.text == "Out")
  #expect(result.textTone == .out)
}

@Test func signInOutranksOutInTheFallback() throws {
  let list =
    try items([account("zero", .claude, left: 0)], state: .offline)
    + items([account("gone", .codex, left: 3)], state: .signedOut)
  let result = status(.logoAndRoom, visible: list, sources: [.offline, .signedOut])
  #expect(result.text == "!")
}

@Test func logoAndRoomWithNoSourcesShowsNothing() {
  let result = status(.logoAndRoom, visible: [], sources: [])
  #expect(result.text == nil)
  #expect(result.textTone == .plain)
  #expect(result.tooltip == "Headroom\nTightest account: no readings yet")
  #expect(result.summary == "Headroom, all accounts, no readings yet")
}

@Test func logoAndRoomBeforeTheFirstReadShowsEllipsis() {
  let result = status(.logoAndRoom, visible: [], sources: [.connected], ready: false)
  #expect(result.text == "…")
  #expect(result.textTone == .plain)
}

@Test func logoAndRoomWithAnUnreachableSourceShowsEllipsis() {
  let result = status(.logoAndRoom, visible: [], sources: [.connected, .offline])
  #expect(result.text == "…")
}

@Test func logoAndRoomConnectedWithoutAccountsShowsNothing() {
  let result = status(.logoAndRoom, visible: [], sources: [.connected])
  #expect(result.text == nil)
}

@Test func logoAndRoomConnectedWithoutAFigureShowsUnknown() throws {
  let list = try items([account("blank", .claude, left: nil)])
  let result = status(.logoAndRoom, visible: list)
  #expect(result.text == "Unknown")
  #expect(result.textTone == .plain)
}

@Test func logoAndRoomShowsASampleOnlyWhenNothingResolves() throws {
  let world = try World()
  #expect(status(.logoAndRoom, visible: [], sources: [], sample: true).text == "64% left")
  #expect(
    status(.logoAndRoom, preferences(view: .used), visible: [], sources: [], sample: true).text
      == "36% used")
  #expect(status(.logoAndRoom, visible: world.healthy, sample: true).text == "60% left")
  #expect(status(.logoAndRoom, visible: [], sources: []).text == nil)
  #expect(status(.logo, visible: [], sources: [], sample: true).text == nil)
}

@Test func logoAndRoomShowsAnOutFollowedAccount() throws {
  let world = try World()
  let result = status(.logoAndRoom, visible: [world.delta])
  #expect(result.text == "Out")
  #expect(result.textTone == .out)
}

@Test func logoAndRoomShowsASignedOutFollowedAccountAsBang() throws {
  let list = try items([account("gone", .claude, left: 30, state: .reconnect_required)])
  let pinned = preferences(slots: [Slot(account: list[0].id)])
  let result = status(.logoAndRoom, pinned, visible: list)
  #expect(result.text == "!")
  #expect(result.textTone == .out)
}

@Test func aPinnedRemovedFollowedAccountFallsBackToTheChain() throws {
  let world = try World()
  let pinned = preferences(slots: [Slot(account: "removed/account")])
  let result = status(.logoAndRoom, pinned, visible: world.healthy)
  // The pinned account is gone, so no account is followed; accounts exist, so "Unknown".
  #expect(result.text == "Unknown")
}

// MARK: Tones and view figures

@Test func tonesFollowTheAccountState() throws {
  let world = try World()
  let list = try items([
    account("fine", .cursor, left: 70),
    account("gone", .claude, left: 40, state: .reconnect_required),
  ])
  let result = status(
    .accounts, preferences(slots: [Slot(), Slot(account: list[1].id)]), visible: list)
  #expect(result.readings.map(\.tone) == [.plain, .out])
  #expect(result.readings.map(\.text) == ["70%", "!"])
  let tight = status(
    .accounts, preferences(slots: [Slot(), Slot()]), visible: [world.bravo, world.delta])
  #expect(tight.readings.map(\.tone) == [.low, .out])
  #expect(tight.readings.map(\.text) == ["15%", "Out"])
}

@Test func theRoomViewShowsRoomLeftAndFillsWithIt() throws {
  let world = try World()
  let result = status(.accounts, preferences(view: .left), visible: [world.alpha])
  let reading = try #require(result.readings.first)
  #expect(reading.left == 50)
  #expect(reading.fill == 50)
  #expect(reading.text == "50%")
  #expect(result.tooltip == "Headroom\nClaude Alpha: 50% left")
}

@Test func theUsedViewShowsTheShareUsedAndFillsWithIt() throws {
  let world = try World()
  let result = status(.accounts, preferences(view: .used), visible: [world.alpha])
  let reading = try #require(result.readings.first)
  // Ranking and colors still follow room left.
  #expect(reading.left == 50)
  #expect(reading.fill == 50)
  let bravo = status(.accounts, preferences(view: .used), visible: [world.bravo])
  let low = try #require(bravo.readings.first)
  #expect(low.left == 15)
  #expect(low.fill == 85)
  #expect(low.text == "85%")
  #expect(low.tone == .low)
  #expect(bravo.tooltip == "Headroom\nCodex Bravo: 85% used")
  #expect(bravo.summary == "Headroom, Codex Bravo, 85% used")
}

@Test func theUsedViewChangesTheLogoAndRoomText() throws {
  let world = try World()
  let result = status(.logoAndRoom, preferences(view: .used), visible: [world.bravo])
  #expect(result.text == "85% used")
  #expect(result.textTone == .low)
}

@Test func barsReadTheSessionThenTheLongerWindow() throws {
  let list = try items([account("both", .codex, left: 90, session: 15)])
  let left = status(
    .accounts, preferences(slots: [Slot(look: .bars)], view: .left), visible: list)
  let bars = try #require(left.readings.first).bars
  #expect(bars.map(\.fill) == [15, 90])
  #expect(bars.map(\.tone) == [.low, .plain])
  let used = status(
    .accounts, preferences(slots: [Slot(look: .bars)], view: .used), visible: list)
  #expect(try #require(used.readings.first).bars.map(\.fill) == [85, 10])
}

@Test func barsAreEmptyForOtherLooks() throws {
  let list = try items([account("both", .codex, left: 90, session: 15)])
  for look in [Slot.Look.percent, .ring] {
    let result = status(.accounts, preferences(slots: [Slot(look: look)]), visible: list)
    let reading = try #require(result.readings.first)
    #expect(reading.bars.isEmpty)
    #expect(reading.look == look)
  }
}

@Test func anOutSessionBarIsOut() throws {
  let list = try items([account("both", .codex, left: 90, session: 0)])
  let result = status(.accounts, preferences(slots: [Slot(look: .bars)]), visible: list)
  let reading = try #require(result.readings.first)
  #expect(reading.bars.first?.tone == .out)
  #expect(reading.tone == .out)
}

@Test func toneMapsEveryRoomState() {
  #expect(MenuReading.tone(.out) == .out)
  #expect(MenuReading.tone(.signIn) == .out)
  #expect(MenuReading.tone(.tight) == .low)
  #expect(MenuReading.tone(.room) == .plain)
  #expect(MenuReading.tone(.unknown) == .plain)
  #expect(MenuReading.tone(.kept) == .plain)
}

@Test func anUnknownSlotShowsWordsNotAFigure() throws {
  let list = try items([account("blank", .claude, left: nil)])
  let connected = status(.accounts, preferences(slots: [Slot(account: list[0].id)]), visible: list)
  let reading = try #require(connected.readings.first)
  #expect(reading.text == "Unknown")
  #expect(reading.left == nil)
  #expect(reading.fill == nil)
  #expect(reading.tone == .plain)
  #expect(connected.tooltip == "Headroom\nClaude Blank: Unknown")
  let offline = try items([account("blank", .claude, left: nil)], state: .offline)
  let pinned = status(
    .accounts, preferences(slots: [Slot(account: offline[0].id)]), visible: offline,
    sources: [.offline])
  #expect(pinned.readings.first?.text == "…")
}

// MARK: The dot

@Test func unreadNotificationsShowAPlainDot() throws {
  let world = try World()
  let result = status(.accounts, visible: world.healthy, unread: 2)
  #expect(result.dot == .plain)
  #expect(result.summary.hasSuffix(", 2 unread notifications"))
}

@Test func noUnreadAndNoProblemShowsNoDot() throws {
  let world = try World()
  #expect(status(.accounts, visible: world.healthy).dot == nil)
  #expect(!status(.accounts, visible: world.healthy).summary.contains("unread"))
}

@Test func anOutAccountOutsideTheSlotsShowsAnOutDot() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: [Slot()]), visible: world.all)
  #expect(result.dot == .out)
}

@Test func aSignedOutAccountOutsideTheSlotsShowsAnOutDot() throws {
  let list = try items([
    account("fine", .cursor, left: 70),
    account("gone", .claude, left: 40, state: .reconnect_required),
  ])
  #expect(status(.accounts, preferences(slots: [Slot()]), visible: list).dot == .out)
  let signedOut = try items([account("late", .codex, left: 30)], state: .signedOut)
  let both = status(
    .accounts, preferences(slots: [Slot()]), visible: [list[0]] + signedOut,
    sources: [.connected, .signedOut])
  #expect(both.dot == .out)
}

@Test func aProblemInsideASlotShowsNoDot() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: [Slot()]), visible: [world.delta])
  #expect(names(result) == ["Grok Delta"])
  #expect(result.dot == nil)
  let pinned = status(
    .accounts, preferences(slots: [Slot(account: world.delta.id), Slot()]), visible: world.all)
  #expect(pinned.dot == nil)
}

@Test func aProblemInsideASlotStillShowsTheUnreadDot() throws {
  let world = try World()
  let result = status(.accounts, visible: [world.delta], unread: 1)
  #expect(result.dot == .plain)
}

@Test func aProblemOutsideTheSlotsOutranksUnread() throws {
  let world = try World()
  let result = status(.accounts, visible: world.all, unread: 4)
  #expect(result.dot == .out)
}

@Test func theLogoStyleShowsAnOutDotForAnyProblem() throws {
  let world = try World()
  #expect(status(.logo, visible: world.all).dot == .out)
  #expect(status(.logo, visible: world.healthy).dot == nil)
}

@Test func aHiddenProblemAccountDoesNotRaiseTheDot() throws {
  let world = try World()
  #expect(status(.logo, visible: world.healthy, all: world.all).dot == nil)
}

// MARK: Live room

@Test func liveRoomPicksAnOutSlotFirst() throws {
  let world = try World()
  let result = status(
    .liveLogo, preferences(slots: threeTightest, liveRoom: true),
    visible: [world.bravo, world.alpha, world.delta])
  #expect(names(result) == ["Codex Bravo", "Claude Alpha", "Grok Delta"])
  #expect(result.liveRoom?.name == "Grok Delta")
  #expect(result.liveRoom?.text == "Out")
}

@Test func liveRoomPicksTheLeastRoomOtherwise() throws {
  let world = try World()
  let result = status(
    .liveLogo, preferences(slots: threeTightest, liveRoom: true), visible: world.healthy)
  // Echo ranks first for its projection, but Bravo has the least room.
  #expect(names(result).first == "Copilot Echo")
  #expect(result.liveRoom?.name == "Codex Bravo")
  #expect(result.liveRoom?.text == "15%")
}

@Test func liveRoomIgnoresASlotWithoutAFigure() throws {
  let world = try World()
  let blank = try items([account("blank", .claude, left: nil)])
  let result = status(
    .liveLogo, preferences(slots: [Slot(account: blank[0].id), Slot()], liveRoom: true),
    visible: [world.charlie], all: blank + [world.charlie])
  #expect(names(result) == ["Claude Blank", "Cursor Charlie"])
  #expect(result.liveRoom?.name == "Cursor Charlie")
}

@Test func liveRoomNeedsTheSettingAndTheLiveLogoStyle() throws {
  let world = try World()
  let off = status(
    .liveLogo, preferences(slots: threeTightest, liveRoom: false), visible: world.healthy)
  #expect(off.liveRoom == nil)
  for style in [DisplayPreferences.ItemStyle.dots, .accounts, .logoAndRoom, .logo] {
    let result = status(
      style, preferences(slots: threeTightest, liveRoom: true), visible: world.healthy)
    #expect(result.liveRoom == nil)
  }
}

// MARK: Tooltip and summary

@Test func slotStylesListOneTooltipLinePerSlot() throws {
  let world = try World()
  let result = status(.accounts, preferences(slots: threeTightest), visible: world.healthy)
  #expect(
    result.tooltip
      == "Headroom\nCopilot Echo: 60% left\nCodex Bravo: 15% left\nClaude Alpha: 50% left")
  #expect(
    result.summary
      == "Headroom, Copilot Echo, 60% left, Codex Bravo, 15% left, Claude Alpha, 50% left")
}

@Test func anOutSlotSaysOutInTheTooltip() throws {
  let world = try World()
  let result = status(.accounts, visible: [world.delta], unread: 3)
  #expect(result.tooltip == "Headroom\nGrok Delta: Out")
  #expect(result.summary == "Headroom, Grok Delta, Out, 3 unread notifications")
}

@Test func logoAndRoomNamesTheFollowedAccount() throws {
  let world = try World()
  let result = status(.logoAndRoom, visible: world.healthy, unread: 1)
  #expect(result.tooltip == "Headroom\nCopilot Echo: 60% left")
  #expect(result.summary == "Headroom, Copilot Echo, 60% left, 1 unread notifications")
}

@Test func aSlotStyleWithNoReadingsHasOnlyTheTitle() throws {
  let result = status(.accounts, visible: [], sources: [])
  #expect(result.readings.isEmpty)
  #expect(result.tooltip == "Headroom")
  #expect(result.summary == "Headroom")
}

// MARK: Samples

@Test func samplesFillTheSlotsWhenNothingResolves() {
  let looks: [Slot.Look] = [.percent, .ring, .bars]
  let slots = looks.map { Slot(look: $0) }
  let result = status(
    .accounts, preferences(slots: slots), visible: [], sources: [], sample: true)
  #expect(result.readings.map(\.provider) == ["claude", "codex", "cursor"])
  #expect(result.readings.map(\.name) == ["Claude", "Codex", "Cursor"])
  #expect(result.readings.map(\.text) == ["62%", "37%", "74%"])
  #expect(result.readings.map(\.look) == looks)
  #expect(result.readings.allSatisfy { $0.tone == .plain })
  #expect(result.readings.first?.bars.map(\.fill) == [92, 62])
}

@Test func samplesFollowTheUsedView() {
  let result = status(
    .accounts, preferences(slots: [Slot()], view: .used), visible: [], sources: [], sample: true)
  let reading = result.readings.first
  #expect(reading?.text == "38%")
  #expect(reading?.left == 62)
  #expect(reading?.fill == 38)
}

@Test func samplesNeverReplaceRealReadings() throws {
  let world = try World()
  let result = status(.accounts, visible: [world.alpha], sample: true)
  #expect(names(result) == ["Claude Alpha"])
}

@Test func withoutSampleNothingResolvesToNothing() {
  let result = status(.accounts, visible: [], sources: [])
  #expect(result.readings.isEmpty)
}

@Test func samplesHelperStopsAtTheNumberOfLooks() {
  #expect(MenuReading.samples([.percent], view: .left).count == 1)
  #expect(MenuReading.samples([], view: .left).isEmpty)
  #expect(MenuReading.samples([.percent, .percent, .percent, .percent], view: .left).count == 3)
}

// MARK: Colored

@Test func coloredNeedsAToneAndTheColorSetting() throws {
  let world = try World()
  #expect(status(.accounts, preferences(logos: false), visible: [world.bravo]).colored)
  #expect(!status(.accounts, preferences(logos: false), visible: [world.charlie]).colored)
  #expect(
    !status(.accounts, preferences(logos: false, colors: false), visible: [world.bravo]).colored)
  #expect(status(.accounts, preferences(logos: false), visible: [world.delta]).colored)
}

@Test func coloredSeesTonesInTheTextTheDotAndTheBars() throws {
  let world = try World()
  // Logo and room text tone.
  #expect(status(.logoAndRoom, visible: [world.bravo]).colored)
  #expect(!status(.logoAndRoom, visible: [world.charlie]).colored)
  // The out dot, with a plain label.
  #expect(status(.logo, visible: world.all).colored)
  // A plain unread dot is not a color.
  #expect(!status(.logo, visible: world.healthy, unread: 1).colored)
  // A low bar inside a plain reading.
  let list = try items([account("both", .codex, left: 90, session: 15)])
  let bars = status(
    .dots, preferences(slots: [Slot(look: .bars)], logos: false), visible: list)
  #expect(try #require(bars.readings.first).bars.contains { $0.tone == .low })
  #expect(bars.readings.first?.tone == .low)
  #expect(bars.colored)
}

@Test func coloredMarksOnlyCountInTheAccountsStyleWithLogosOn() throws {
  let world = try World()
  let claude = [world.alpha]
  #expect(status(.accounts, preferences(logos: true, colors: false), visible: claude).colored)
  #expect(!status(.accounts, preferences(logos: false, colors: false), visible: claude).colored)
  #expect(!status(.dots, preferences(logos: true, colors: false), visible: claude).colored)
  #expect(!status(.liveLogo, preferences(logos: true, colors: false), visible: claude).colored)
  #expect(!status(.logoAndRoom, preferences(logos: true, colors: false), visible: claude).colored)
}

@Test func plainProvidersDoNotMakeALabelColored() throws {
  let world = try World()
  let result = status(.accounts, preferences(colors: true), visible: [world.charlie])
  #expect(!result.colored)
}

@Test func antigravityIsAColoredMark() throws {
  let list = try items([account("anti", .antigravity, left: 70)])
  #expect(status(.accounts, preferences(colors: false), visible: list).colored)
}

@Test func coloredMarksAreClaudeAndAntigravity() {
  #expect(Presentation.coloredMarks == ["claude", "antigravity"])
}

// MARK: Equatable

@Test func identicalInputsAreEqual() throws {
  let world = try World()
  let prefs = preferences(slots: threeTightest, liveRoom: true)
  let first = status(.liveLogo, prefs, visible: world.healthy, unread: 1)
  let second = status(.liveLogo, prefs, visible: world.healthy, unread: 1)
  #expect(first == second)
}

@Test func aChangedFigureMakesTheStatusesDiffer() throws {
  let first = try items([account("one", .claude, left: 50)])
  let second = try items([account("one", .claude, left: 51)])
  #expect(status(.accounts, visible: first) != status(.accounts, visible: second))
  #expect(status(.logoAndRoom, visible: first) != status(.logoAndRoom, visible: second))
}

@Test func aChangedStyleViewOrUnreadCountMakesTheStatusesDiffer() throws {
  let world = try World()
  let base = status(.accounts, visible: world.healthy)
  #expect(base != status(.dots, visible: world.healthy))
  #expect(base != status(.accounts, preferences(view: .used), visible: world.healthy))
  #expect(base != status(.accounts, visible: world.healthy, unread: 1))
  #expect(base != status(.accounts, preferences(colors: false), visible: world.healthy))
  #expect(base != status(.accounts, preferences(logos: false), visible: world.healthy))
}

@Test func theClockOnlyMattersWhenItChangesAProjection() throws {
  let world = try World()
  let later = MenuStatus(
    style: .accounts, preferences: preferences(), visible: world.healthy, sources: [.connected],
    ready: true, unread: 0, now: now.addingTimeInterval(60))
  #expect(status(.accounts, visible: world.healthy) == later)
}
