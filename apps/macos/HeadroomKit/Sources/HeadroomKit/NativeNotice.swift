import Foundation
import HeadroomAPI

/// A server notice, or the Mac's source-token failure. No provider identity is invented for a source.
public struct NativeNotice: Codable, Sendable {
  public let id: String
  public let kind: NoticeKind
  public let tone: FeedNotice.tonePayload
  public let occurredAt: Date
  public let title: String
  public let message: String
  public let accountID: String?
  public let accountLabel: String
  /// The provider whose mark sits beside the account; nil for a source notice.
  public let provider: String?

  public init(_ notice: FeedNotice, sourceName: String) {
    id = notice.id
    kind = notice.kind
    tone = notice.tone
    occurredAt = Formatting.date(milliseconds: notice.occurredAt) ?? .distantPast
    title = notice.title
    switch notice.kind {
    case .disconnected:
      message =
        "Readings stopped. Open \(sourceName) and sign in to \(Presentation.providerName(notice.provider.rawValue)) again in its web dashboard."
    case .refresh_failed:
      message = "Last reading kept. Open \(sourceName) to check the connection and refresh status."
    case .auto_reset:
      message = "The owner's rule on \(sourceName): \(notice.message)"
    default: message = notice.message
    }
    accountID = notice.connection.id
    accountLabel =
      "\(Presentation.providerName(notice.provider.rawValue)) \(notice.connection.name)"
    provider = notice.provider.rawValue
  }
  public init(signedOutSource source: Source, firstSeen: Date) {
    id = NoticeStore.sourceSignOutID
    kind = .disconnected
    tone = .bad
    occurredAt = firstSeen
    title = "\(source.name) is signed out"
    message =
      "Readings stopped. Open this source's web dashboard to replace its API token in Headroom Settings."
    accountID = nil
    accountLabel = source.name
    provider = nil
  }
}

/// The Notices list groups by calendar day: today, yesterday, then everything older.
public enum NoticeDay: String, CaseIterable, Sendable {
  case today = "Today"
  case yesterday = "Yesterday"
  case earlier = "Earlier"

  public init(_ date: Date, now: Date = Date(), calendar: Calendar = .current) {
    if calendar.isDate(date, inSameDayAs: now) {
      self = .today
    } else if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
      calendar.isDate(date, inSameDayAs: yesterday)
    {
      self = .yesterday
    } else {
      self = .earlier
    }
  }
}

public enum BannerTone {
  public enum Level: Equatable, Sendable { case passive, active, timeSensitive }
  public static func level(_ tone: FeedNotice.tonePayload, timeSensitiveAllowed: Bool) -> Level {
    switch tone {
    case .bad: timeSensitiveAllowed ? .timeSensitive : .active
    case .warn: .active
    case .info: .passive
    }
  }
  /// A banner names who it is about and stops there: the title says what happened, the
  /// subtitle the account and source. The message stays in Headroom's Notices list.
  public static func subtitle(account: String?, source: String) -> String {
    account.map { "\($0) · \(source)" } ?? source
  }
  public static func thread(sourceID: UUID, accountID: String?) -> String {
    "\(sourceID.uuidString)/\(accountID ?? "source")"
  }
}
