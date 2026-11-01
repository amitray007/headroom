import AppKit
import HeadroomKit
import SwiftUI
import UserNotifications

/// Made-up notices for Settings: one per kind of interruption, with synthetic account names.
enum BannerSample: String, CaseIterable, Identifiable {
  case almostOut, runningLow, resetGranted, disconnected, signedOut
  var id: String { rawValue }

  var label: String {
    switch self {
    case .almostOut: "Almost out"
    case .runningLow: "Running low"
    case .resetGranted: "Reset granted"
    case .disconnected: "Disconnected"
    case .signedOut: "Source signed out"
    }
  }
  var tone: NoticeTone {
    switch self {
    case .almostOut, .disconnected, .signedOut: .bad
    case .runningLow: .warn
    case .resetGranted: .info
    }
  }
  func title(source: String) -> String {
    switch self {
    case .almostOut: "Codex Is Almost Out of Its Weekly Limit"
    case .runningLow: "Claude 5h Limit Is Running Low"
    case .resetGranted: "Codex Banked a New Reset"
    case .disconnected: "Grok Is Disconnected"
    case .signedOut: "\(source) is signed out"
    }
  }
  private var account: String? {
    switch self {
    case .almostOut, .resetGranted: "Codex Work"
    case .runningLow: "Claude Personal"
    case .disconnected: "Grok Main"
    case .signedOut: nil
    }
  }
  func subtitle(source: String) -> String { BannerTone.subtitle(account: account, source: source) }

  /// How macOS treats this tone, in the words of its own Notifications settings.
  var behavior: String {
    switch tone {
    case .bad:
      "Time Sensitive: shows through Focus when Headroom may break through it, otherwise a normal banner."
    case .warn: "A normal banner with sound. Focus holds it back."
    case .info: "Passive: goes to Notification Center quietly, often without a banner."
    }
  }
}

/// The Notifications pane's first section: a banner preview and a button that sends it.
struct NotificationTestSection: View {
  @Bindable var model: AppModel
  @State private var sample = BannerSample.almostOut
  @State private var status: UNAuthorizationStatus?
  @State private var result: NotificationBanners.TestResult?
  @State private var sending = false

  private var source: String { model.sources.first?.source.name ?? "Home server" }

  var body: some View {
    SettingsSection("Preview") {
      BannerPreview(
        title: sample.title(source: source), subtitle: sample.subtitle(source: source),
        timeSensitive: sample.tone == .bad
      ).padding(.vertical, 10)
      SettingsRow(title: "Sample", note: sample.behavior) {
        WebSelect(value: sample.label) {
          ForEach(BannerSample.allCases) { option in
            Button(option.label) {
              sample = option
              result = nil
            }
          }
        }
      }
      SettingsRow(title: "Send a test banner", note: note) {
        HStack(spacing: 8) {
          if status == .denied {
            Button("Open System Settings", action: openSystemSettings)
              .buttonStyle(WebButtonStyle(small: true))
          }
          Button(sending ? "Sending" : "Send test", action: send)
            .buttonStyle(WebButtonStyle(small: true)).disabled(sending)
        }
      }
    }
    .task { status = await model.banners.authorization() }
    // Permission can change in System Settings while this pane is open.
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) {
      _ in Task { status = await model.banners.authorization() }
    }
  }

  private var note: String {
    switch result {
    case .sent: return "Sent. It ignores the switches below and opens nothing when clicked."
    case .failed: return "macOS did not accept the test. Try again."
    case .denied, nil: break
    }
    switch status {
    case .denied:
      return "Banners are off for Headroom. Turn on Allow notifications in System Settings, Notifications, Headroom."
    case .notDetermined: return "macOS asks for permission the first time."
    default: return "Shows the sample as a real banner, with its tone. Switches below do not apply."
    }
  }

  private func send() {
    sending = true
    Task {
      result = await model.banners.sendTest(
        title: sample.title(source: source), subtitle: sample.subtitle(source: source),
        tone: sample.tone)
      status = await model.banners.authorization()
      sending = false
    }
  }

  private func openSystemSettings() {
    let id = Bundle.main.bundleIdentifier ?? "club.theblank.headroom.mac"
    if let url = URL(
      string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)")
    {
      NSWorkspace.shared.open(url)
    }
  }
}

/// A macOS banner as Headroom fills it: the app icon, the title and the account and source.
private struct BannerPreview: View {
  let title: String
  let subtitle: String
  let timeSensitive: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 36, height: 36)
      VStack(alignment: .leading, spacing: 1) {
        HStack {
          Text(timeSensitive ? "TIME SENSITIVE" : "HEADROOM")
            .font(.system(size: 10, weight: .semibold)).tracking(0.3)
            .foregroundStyle(timeSensitive ? HR.popoverDanger : HR.textMuted)
          Spacer()
          Text("now").font(.system(size: 11)).foregroundStyle(HR.textMuted)
        }
        Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(HR.ink)
        Text(subtitle).font(.system(size: 13)).foregroundStyle(HR.ink)
      }
      .lineLimit(1)
    }
    .padding(.horizontal, 12).padding(.vertical, 11)
    .frame(maxWidth: 360)
    .background(HR.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(HR.border))
    .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
    .padding(14).frame(maxWidth: .infinity)
    .background(HR.muted, in: RoundedRectangle(cornerRadius: 12))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Banner preview: \(title). \(subtitle)")
  }
}
