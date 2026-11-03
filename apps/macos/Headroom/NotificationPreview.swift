import AppKit
import HeadroomKit
import SwiftUI
import UserNotifications

/// Made-up notices for the Settings preview: one per kind of interruption, with synthetic account names.
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

}

/// The top of the Notifications pane: whether macOS lets Headroom notify, then a banner
/// preview.
struct NotificationPreviewSection: View {
  @Bindable var model: AppModel
  @State private var sample = BannerSample.almostOut
  @State private var permission: NotificationBanners.Permission?

  private var source: String { model.sources.first?.source.name ?? "Home server" }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let permission {
        PermissionCard(permission: permission, enable: enable)
          .padding(.horizontal, 24).padding(.top, 20).padding(.bottom, 4)
      }
      SettingsSection("Preview") {
        WebSelect(value: sample.label) {
          ForEach(BannerSample.allCases) { option in
            Button(option.label) { sample = option }
          }
        }
      } content: {
        BannerPreview(
          title: sample.title(source: source), subtitle: sample.subtitle(source: source),
          timeSensitive: sample.tone == .bad && permission?.timeSensitive == true
        ).padding(.vertical, 10)
      }
    }
    .task { await refresh() }
    // Permission can change in System Settings while this pane is open.
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) {
      _ in Task { await refresh() }
    }
  }

  private func refresh() async { permission = await model.banners.permission() }

  /// Asks macOS once; after a refusal only System Settings can turn notifications on.
  private func enable() {
    Task {
      _ = await model.banners.requestPermission()
      await refresh()
    }
  }

}

/// One line of state with the action that fixes it: Enable before macOS has asked, System
/// Settings after a refusal or with banners turned off, Manage when all is well.
private struct PermissionCard: View {
  let permission: NotificationBanners.Permission
  let enable: () -> Void

  private enum Phase { case ask, off, quiet, on }
  private var state: Phase {
    switch permission.status {
    case .notDetermined: .ask
    case .denied: .off
    case .provisional: .quiet
    default: permission.style == .none ? .quiet : .on
    }
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: symbol).font(.system(size: 14, weight: .medium))
        .foregroundStyle(state == .on ? HR.ink : HR.warning)
        .frame(width: 32, height: 32)
        .background(HR.muted, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink)
        Text(detail).font(HR.popoverFont(12)).foregroundStyle(HR.textMuted)
      }
      Spacer(minLength: 16)
      switch state {
      case .ask:
        Button("Enable", action: enable).buttonStyle(WebButtonStyle(kind: .primary, small: true))
      case .off, .quiet:
        Button("Open System Settings", action: Self.openSystemSettings)
          .buttonStyle(WebButtonStyle(small: true))
      case .on:
        Button("Manage", action: Self.openSystemSettings)
          .buttonStyle(WebButtonStyle(kind: .quiet, small: true))
      }
    }
    .padding(12)
    .background(HR.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(HR.border))
    .accessibilityElement(children: .contain)
  }

  private var symbol: String {
    switch state {
    case .ask: "bell"
    case .off: "bell.slash"
    case .quiet: "bell.badge"
    case .on: "checkmark"
    }
  }
  private var title: String {
    switch state {
    case .ask: "Notifications are not on"
    case .off: "Notifications are off"
    case .quiet: "Banners are off"
    case .on: "Notifications are on"
    }
  }
  private var detail: String {
    switch state {
    case .ask: "macOS asks once."
    case .off: "Turn them on for Headroom in System Settings."
    case .quiet: "Notices go to Notification Center only."
    case .on: permission.timeSensitive ? "Banners, Time Sensitive" : "Banners"
    }
  }

  static func openSystemSettings() {
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
