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
  public static func thread(sourceID: UUID, accountID: String?) -> String {
    "\(sourceID.uuidString)/\(accountID ?? "source")"
  }
}
