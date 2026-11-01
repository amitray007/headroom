import Foundation
import HeadroomAPI

/// Display-only quota semantics for the popover. Money never becomes quota room.
public struct RoomColumn: Identifiable, Sendable {
  public enum State: Equatable, Sendable { case room, tight, out, signIn, unknown, kept }
  public let item: AccountItem
  public let limit: FeedAccount.limitsPayloadPayload?
  public let state: State
  public let percentLeft: Double?
  public let runsOutAt: Date?
  public var id: String { item.id }

  public init(item: AccountItem, now: Date) {
    self.item = item
    limit = RoomNow.binding(item.account, now: now)
    percentLeft = limit?.percentLeft.map { min(100, max(0, $0)) }
    runsOutAt = limit.flatMap { RoomNow.projection($0, now: now) }
    if item.snapshot.state == .signedOut || item.account.state == .reconnect_required {
      state = .signIn
    } else if item.snapshot.state != .connected, percentLeft != nil {
      state = .kept
    } else if percentLeft == nil {
      state = .unknown
    } else if percentLeft == 0 {
      state = .out
    } else if runsOutAt != nil || (percentLeft ?? 100) <= 20 {
      state = .tight
    } else {
      state = .room
    }
  }

  public var hasRoom: Bool {
    (state == .room || state == .tight || state == .kept) && (percentLeft ?? 0) > 0
  }

  public func text(now: Date, timeZone: TimeZone = .current) -> String {
    var parts = [item.name]
    if state == .kept { parts.append("\(item.snapshot.source.name) offline. Kept reading") }
    if state == .signIn { parts.append("Sign-in needed. Last reading") }
    if let limit {
      parts.append("\(limit.label): \(Formatting.percentLeft(percentLeft))")
      parts.append(
        "\(state == .out ? "Out. Back" : "Resets") \(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: now, timeZone: timeZone))"
      )
    } else {
      parts.append("Quota unknown")
    }
    if let runsOutAt, state != .signIn && state != .kept {
      parts.append(Formatting.runOut(runsOutAt, now: now, timeZone: timeZone))
    }
    if item.account.limits.contains(where: { !$0.unlimited && $0.percentLeft == nil }) {
      parts.append("Other limits unknown")
    }
    return parts.joined(separator: ". ")
  }
}

public struct RoomNow: Sendable {
  public let columns: [RoomColumn]
  public var roomCount: Int { columns.filter(\.hasRoom).count }
  public var headline: String { "\(roomCount) of \(columns.count) accounts have room" }
  public var nextBack: RoomColumn? {
    columns.filter { $0.state == .out && $0.limit?.resetsAt != nil }.min {
      ($0.limit?.resetsAt ?? 0) < ($1.limit?.resetsAt ?? 0)
    }
  }

  public init(items: [AccountItem], now: Date) {
    var providers: [String] = []
    for item in items {
      for provider in item.snapshot.cached?.feed.providerOrder.map(\.rawValue) ?? []
      where !providers.contains(provider) { providers.append(provider) }
    }
    for item in items where !providers.contains(item.account.provider.rawValue) {
      providers.append(item.account.provider.rawValue)
    }
    columns = providers.flatMap { provider in
      items.filter { $0.account.provider.rawValue == provider }.map {
        RoomColumn(item: $0, now: now)
      }
    }
  }

  public static func binding(_ account: FeedAccount, now: Date)
    -> FeedAccount.limitsPayloadPayload?
  {
    let known = account.limits.filter {
      !$0.part && !$0.unlimited && !$0.notStarted && $0.percentLeft?.isFinite == true
    }
    // An account stays out until its last exhausted window returns.
    if let out = known.filter({ ($0.percentLeft ?? 100) <= 0 }).max(by: {
      ($0.resetsAt ?? Int.max) < ($1.resetsAt ?? Int.max)
    }) {
      return out
    }
    if let projected = known.filter({ projection($0, now: now) != nil }).min(by: {
      ($0.runsOutAt ?? Int.max) < ($1.runsOutAt ?? Int.max)
    }) {
      return projected
    }
    return known.min { ($0.percentLeft ?? 100) < ($1.percentLeft ?? 100) }
  }

  public static func projection(_ limit: FeedAccount.limitsPayloadPayload, now: Date) -> Date? {
    guard let left = limit.percentLeft, left > 0,
      let at = Formatting.date(milliseconds: limit.runsOutAt), at > now,
      let reset = Formatting.date(milliseconds: limit.resetsAt), at < reset
    else { return nil }
    return at
  }
}
