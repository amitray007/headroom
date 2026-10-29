import AppKit
import HeadroomKit
import SwiftUI

@main @MainActor
struct HeadroomApp: App {
  @NSApplicationDelegateAdaptor(HeadroomDelegate.self) private var delegate
  var body: some Scene {
    Settings { SettingsView(model: delegate.model) }
      .defaultSize(width: 700, height: 598)
      .windowResizability(.contentSize)
  }
}

@MainActor
final class HeadroomDelegate: NSObject, NSApplicationDelegate {
  let model = AppModel()
  private var menuBar: MenuBarController?
  func applicationDidFinishLaunching(_ notification: Notification) {
    HR.registerFonts()
    menuBar = MenuBarController(model: model)
    Task {
      await model.start()
      #if DEBUG
        if model.synthetic && CommandLine.arguments.contains("--open-popover") {
          model.popoverPresented = true
        }
        if model.synthetic && CommandLine.arguments.contains("--open-notice"),
          let item = model.notices.first
        {
          model.requestBannerNotice(sourceID: item.source.id, noticeID: item.notice.id)
        }
        if let index = CommandLine.arguments.firstIndex(of: "--capture-widgets"),
          CommandLine.arguments.indices.contains(index + 1), model.synthetic
        {
          WidgetCapture.run(directory: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
          return
        }
        if let index = CommandLine.arguments.firstIndex(of: "--capture"),
          CommandLine.arguments.indices.contains(index + 1), model.synthetic
        {
          await SyntheticCapture.run(
            model: model, directory: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
        }
      #endif
    }
  }
  func application(_ application: NSApplication, open urls: [URL]) {
    guard urls.contains(where: { $0.scheme == "headroom" && $0.host == "popover" }) else { return }
    model.popoverPresented = true
    application.activate()
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

struct MenuItemLabel: View {
  let model: AppModel
  let style: DisplayPreferences.ItemStyle
  private var followed: AccountItem? {
    if let id = model.preferences.followedAccount {
      return model.allAccounts.first(where: { $0.id == id })
    }
    return model.accounts.max { rank($0) < rank($1) }
  }
  private func rank(_ item: AccountItem) -> Double {
    if item.snapshot.state == .signedOut || item.account.state == .reconnect_required { return 600 }
    if item.snapshot.state != .connected { return 500 }
    if let last = Formatting.date(milliseconds: item.account.lastSuccessAt),
      model.now.timeIntervalSince(last) * 1000
        > Double(item.snapshot.cached?.feed.staleAfterMs ?? 0)
    {
      return 400
    }
    if item.binding?.percentLeft == 0 { return 300 }
    if item.binding?.runsOutAt != nil { return 200 }
    guard let left = item.binding?.percentLeft else { return 100 }
    return 100 - left
  }
  private var text: String {
    if let followed {
      if followed.snapshot.state == .signedOut || followed.account.state == .reconnect_required {
        return "!"
      }
      if followed.snapshot.state != .connected { return "…" }
      return followed.binding.map { Formatting.percentLeft($0.percentLeft) } ?? "Unknown"
    }
    if model.sources.contains(where: { $0.state == .signedOut }) { return "!" }
    if !model.ready || model.sources.contains(where: { $0.state != .connected }) { return "…" }
    return "Unknown"
  }
  private var tone: Color {
    guard let followed else { return .primary }
    if followed.snapshot.state == .signedOut || followed.account.state == .reconnect_required
      || followed.binding?.percentLeft == 0
    {
      return HR.danger
    }
    if followed.binding?.runsOutAt != nil || followed.binding?.percentLeft.map({ $0 <= 20 }) == true
    {
      return HR.warning
    }
    return .primary
  }
  var body: some View {
    HStack(spacing: 3) {
      if style != .percentage {
        HeadroomGlyph().frame(width: 23, height: 23)
          .overlay(alignment: .bottomTrailing) {
            if model.unread > 0 {
              Circle().fill(tone).frame(width: 5, height: 5).offset(x: -2, y: -2)
            }
          }
      }
      if style != .logoAndBadge {
        Text(text).font(.system(size: 13, weight: .medium)).monospacedDigit()
      }
      if style == .percentage && model.unread > 0 {
        Circle().frame(width: 5, height: 5)
      }
      if style == .pinned { Image(systemName: "pin").font(.system(size: 11)) }
    }
    .foregroundStyle(tone)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "Headroom, \(followed?.name ?? "all sources"), \(text), \(model.unread) unread notices")
  }
}
