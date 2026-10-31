import Foundation
import Testing

@testable import HeadroomKit

@Test func percentLeftNeverTurnsUnknownIntoZero() {
  #expect(Formatting.left(used: nil) == nil)
  #expect(Formatting.left(used: 63) == 37)
  #expect(Formatting.left(used: 110) == 0)
  #expect(Formatting.percentLeft(nil) == "Unknown")
  #expect(Formatting.percentLeft(0) == "0% left")
  #expect(Formatting.percentLeft(37) == "37% left")
  #expect(Formatting.percentLeft(37.5) == "37.5% left")
}

private let durationCases: [(Double, String)] = [
  (13080, "3 h 38 min"), (144000, "1 day 16 h"), (410400, "4 days 18 h"), (29, "0 min"),
  (-60, "0 min"),
]

@Test(arguments: durationCases)
func durationsMatchTheMockup(_ seconds: Double, _ expected: String) {
  #expect(Formatting.duration(seconds) == expected)
}

@Test func ageClockAndDatesMatchTheMockup() throws {
  let now = Date(timeIntervalSince1970: 1_793_286_000)  // 2026-10-29 15:00 UTC
  let utc = try #require(TimeZone(secondsFromGMT: 0))
  #expect(Formatting.age(now.addingTimeInterval(-7 * 60), now: now) == "7 min ago")
  #expect(Formatting.age(now.addingTimeInterval(-3 * 3600), now: now) == "3 h ago")
  #expect(Formatting.age(now.addingTimeInterval(-2 * 86400), now: now) == "2 days ago")
  #expect(Formatting.age(nil, now: now) == "Unknown")
  #expect(Formatting.clock(now, timeZone: utc) == "15:00")
  #expect(Formatting.clock(now, timeZone: utc, twelveHour: true) == "3:00 pm")
  #expect(Formatting.when(nil, now: now, timeZone: utc) == "Unknown")
  #expect(Formatting.when(now, now: now, timeZone: utc) == "15:00")
  #expect(Formatting.when(now.addingTimeInterval(86400), now: now, timeZone: utc) == "Fri 15:00")
  #expect(
    Formatting.when(now.addingTimeInterval(6 * 86400), now: now, timeZone: utc) == "Wed 4 Nov")
  #expect(Formatting.runOut(now, now: now, timeZone: utc) == "Runs out 15:00 if the pace holds")
}

@Test func statusUsesServerPercentAndProjectionWithMockupPrecedence() throws {
  let feed = try fixture()
  let now = try #require(Formatting.date(milliseconds: feed.generatedAt))
  let utc = try #require(TimeZone(secondsFromGMT: 0))
  var account = try #require(feed.accounts.first { !$0.limits.isEmpty })
  account.state = .ready
  account.lastSuccessAt = feed.generatedAt
  account.observedAt = feed.generatedAt
  var limit = try #require(account.limits.first)
  limit.part = false
  limit.percentLeft = 45
  limit.runsOutAt = nil
  account.limits = [limit]
  #expect(Formatting.status(account, staleAfterMs: feed.staleAfterMs, now: now) == "45% left")
  account.limits[0].runsOutAt = feed.generatedAt + 3600_000
  #expect(
    Formatting.status(account, staleAfterMs: feed.staleAfterMs, now: now, timeZone: utc).hasSuffix(
      "if the pace holds"))
  account.limits[0].percentLeft = 0
  #expect(
    Formatting.status(account, staleAfterMs: feed.staleAfterMs, now: now).hasPrefix("Out until"))
  account.state = .reconnect_required
  #expect(Formatting.status(account, staleAfterMs: feed.staleAfterMs, now: now) == "Sign in again")
  account.state = .ready
  account.lastSuccessAt = feed.generatedAt - 7200_000
  #expect(Formatting.status(account, staleAfterMs: feed.staleAfterMs, now: now).hasPrefix("Stale,"))
  account.lastSuccessAt = nil
  account.limits[0].percentLeft = nil
  account.charges = []
  #expect(Formatting.status(account, staleAfterMs: feed.staleAfterMs, now: now) == "Unknown")
}

@Test func moneyInventoryAndChargesKeepUnitsAndUnknownsSeparate() throws {
  #expect(Formatting.money(nil, unit: "USD") == "Unknown")
  #expect(Formatting.money(8.2, unit: "USD") == "8.20 USD")
  #expect(Formatting.inventory(nil, unit: "resets") == "Unknown resets")
  #expect(Formatting.inventory(2, unit: "resets") == "2 resets")
  var charge = try #require(fixture().accounts.flatMap(\.charges).first)
  charge.value = 8.2
  charge.unit = "USD"
  charge.unlimited = false
  charge.cap = .init(unit: "USD", value: 20)
  #expect(Formatting.charge(charge) == "8.20 / 20.00 USD")
  charge.cap = .init(unit: "credits", value: 20)
  #expect(Formatting.charge(charge) == "8.20 USD / 20 credits")
  charge.value = nil
  charge.availability = .unknown
  #expect(Formatting.charge(charge) == "Unknown")
  charge.availability = .not_authorized
  #expect(Formatting.charge(charge) == "Not on this plan")
  charge.unlimited = true
  #expect(Formatting.charge(charge) == "Unlimited")
}
