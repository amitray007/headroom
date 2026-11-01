import Foundation
import HeadroomKit
import UserNotifications

@MainActor
final class NotificationBanners: NSObject, UNUserNotificationCenterDelegate {
  var onOpen: ((UUID, String, NativeNotice?) -> Void)?
  private let center = UNUserNotificationCenter.current()
  private var delivering = false

  func install() { center.delegate = self }

  func deliver(_ items: [NoticeItem], store: NoticeStore) async {
    guard !delivering else { return }
    delivering = true
    defer { delivering = false }
    var candidates: [NoticeItem] = []
    for item in items {
      // A source token failure has one local notice. Kept provider notices remain in the list.
      guard item.source.state == .connected || item.notice.id == NoticeStore.sourceSignOutID else {
        continue
      }
      if await store.bannerIDs(sourceID: item.source.id).contains(item.notice.id) {
        candidates.append(item)
      }
    }
    guard !candidates.isEmpty else { return }
    var settings = await center.notificationSettings()
    if settings.authorizationStatus == .notDetermined {
      do {
        // First need means a new eligible notice, never launch or a first-read backlog.
        guard try await center.requestAuthorization(options: [.alert, .badge, .sound]) else {
          return
        }
        settings = await center.notificationSettings()
      } catch { return }
    }
    guard
      settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    else { return }
    for item in candidates {
      // Settings and read state can change while authorization is on screen.
      guard await store.bannerIDs(sourceID: item.source.id).contains(item.notice.id) else {
        continue
      }
      let content = UNMutableNotificationContent()
      content.title = item.notice.title
      content.subtitle = BannerTone.subtitle(
        account: item.notice.accountID == nil ? nil : item.notice.accountLabel,
        source: item.source.source.name)
      content.threadIdentifier = BannerTone.thread(
        sourceID: item.source.id, accountID: item.notice.accountID)
      // Keep display-only content in Notification Center so an older banner can still open
      // its detail after the source stops deriving that notice. No feed or credential is stored.
      guard let savedNotice = try? JSONEncoder().encode(item.notice) else { continue }
      content.userInfo = [
        "sourceID": item.source.id.uuidString, "noticeID": item.notice.id,
        "notice": savedNotice,
      ]
      content.interruptionLevel = Self.level(item.notice.tone, settings: settings)
      do {
        // Persist before submission: a crash cannot submit the same id twice. If the OS rejects
        // this request, the unread notice is still available in Headroom's list.
        guard try await store.claimBanner(id: item.notice.id, sourceID: item.source.id) else {
          continue
        }
        try await center.add(
          UNNotificationRequest(identifier: item.id, content: content, trigger: nil))
      } catch { continue }
    }
  }

  private static func level(_ tone: NoticeTone, settings: UNNotificationSettings)
    -> UNNotificationInterruptionLevel
  {
    switch BannerTone.level(tone, timeSensitiveAllowed: settings.timeSensitiveSetting == .enabled) {
    case .timeSensitive: .timeSensitive
    case .active: .active
    case .passive: .passive
    }
  }

  /// What macOS currently allows Headroom to show.
  func authorization() async -> UNAuthorizationStatus {
    await center.notificationSettings().authorizationStatus
  }

  enum TestResult: Equatable { case sent, denied, failed }

  /// Posts a made-up banner from Settings. It asks for permission the first time, uses the
  /// sample's tone like a real banner and stores nothing, so a click on it opens nothing.
  func sendTest(title: String, subtitle: String, tone: NoticeTone) async -> TestResult {
    var settings = await center.notificationSettings()
    if settings.authorizationStatus == .notDetermined {
      guard (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true
      else { return .denied }
      settings = await center.notificationSettings()
    }
    guard
      settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    else { return .denied }
    let content = UNMutableNotificationContent()
    content.title = title
    content.subtitle = subtitle
    content.threadIdentifier = "test"
    content.interruptionLevel = Self.level(tone, settings: settings)
    do {
      try await center.add(
        UNNotificationRequest(identifier: "test-\(UUID())", content: content, trigger: nil))
      return .sent
    } catch { return .failed }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let source = response.notification.request.content.userInfo["sourceID"] as? String,
      let sourceID = UUID(uuidString: source),
      let noticeID = response.notification.request.content.userInfo["noticeID"] as? String
    else { return }
    let saved = response.notification.request.content.userInfo["notice"] as? Data
    let notice = saved.flatMap { try? JSONDecoder().decode(NativeNotice.self, from: $0) }
    await MainActor.run { onOpen?(sourceID, noticeID, notice?.id == noticeID ? notice : nil) }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions { [.banner, .list] }
}
