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
  /// Settings previews show a sample figure while there is nothing real to show.
  var sample = false
  /// Everything the label shows, worked out once per redraw. As computed properties each read
  /// rebuilt the account list, several times over.
  private struct Status {
    let pinned: AccountItem?
    let followed: AccountItem?
    let anyOut: Bool
    let needsSignIn: Bool
    let text: String?

    @MainActor init(model: AppModel) {
      let accounts = model.accounts
      pinned = model.preferences.followedAccount.flatMap { id in
        model.allAccounts.first { $0.id == id }
      }
      // Without a pinned account, the item follows the tightest account that still has room, so
      // an out or signed-out account never hides where work can continue; those show in the dot.
      var tightest: (item: AccountItem, rank: Double)?
      for item in accounts where item.snapshot.state == .connected {
        guard let binding = item.binding, (binding.percentLeft ?? 0) > 0 else { continue }
        let rank = Self.rank(binding)
        if tightest.map({ rank > $0.rank }) ?? true { tightest = (item, rank) }
      }
      followed = pinned ?? tightest?.item
      anyOut = accounts.contains { $0.binding?.percentLeft == 0 }
      needsSignIn = accounts.contains {
        $0.snapshot.state == .signedOut || $0.account.state == .reconnect_required
      }
      // Nil when there is nothing to report: no source yet, or connected sources with no accounts.
      text =
        if let followed {
          if followed.snapshot.state == .signedOut || followed.account.state == .reconnect_required
          {
            "!"
          } else if followed.snapshot.state != .connected {
            "…"
          } else {
            followed.binding.map { Formatting.percentLeft($0.percentLeft) } ?? "Unknown"
          }
        } else if needsSignIn {
          "!"
        } else if anyOut {
          "Out"
        } else if model.sources.isEmpty {
          nil
        } else if !model.ready || model.sources.contains(where: { $0.state != .connected }) {
          "…"
        } else {
          accounts.isEmpty ? nil : "Unknown"
        }
    }

    private static func rank(_ binding: FeedAccount.limitsPayloadPayload) -> Double {
      if binding.percentLeft == 0 { return 300 }
      if binding.runsOutAt != nil { return 200 }
      guard let left = binding.percentLeft else { return 100 }
      return 100 - left
    }

    var tone: Color {
      guard let followed else {
        return pinned == nil && (needsSignIn || anyOut) ? HR.danger : .primary
      }
      if followed.snapshot.state == .signedOut || followed.account.state == .reconnect_required
        || followed.binding?.percentLeft == 0
      {
        return HR.danger
      }
      if followed.binding?.runsOutAt != nil
        || followed.binding?.percentLeft.map({ $0 <= 20 }) == true
      {
        return HR.warning
      }
      return .primary
    }
    /// The dot carries problems elsewhere (an account out or signed out) while the text follows
    /// room.
    var dotTone: Color { pinned == nil && (needsSignIn || anyOut) ? HR.danger : tone }
    var problem: Bool { pinned == nil && (needsSignIn || anyOut) }
  }

  /// True when the label draws in one color only, so the menu bar can tint it like any icon.
  @MainActor static func monochrome(model: AppModel) -> Bool {
    let status = Status(model: model)
    return status.tone == .primary && !status.problem
  }

  var body: some View {
    let status = Status(model: model)
    let shown = status.text ?? (sample ? Formatting.percentLeft(64) : nil)
    let tone = status.tone
    HStack(spacing: 3) {
      if style != .percentage || shown == nil {
        HeadroomGlyph().frame(width: 23, height: 23)
          .overlay(alignment: .bottomTrailing) {
            if model.unread > 0 || status.problem {
              Circle().fill(status.dotTone).frame(width: 5, height: 5).offset(x: -2, y: -2)
            }
          }
          // The glyph's 64 pt grid leaves 12 pt of air left of the bars; the dot ends 2 pt from the
          // right edge. Trim both so the item is as wide as what it draws.
          .padding(.leading, -4).padding(.trailing, -2)
      }
      if style != .logoAndBadge, let shown {
        Text(shown).font(.system(size: 13, weight: .medium)).monospacedDigit()
      }
      if style == .percentage && (model.unread > 0 || status.problem) {
        Circle().fill(status.dotTone).frame(width: 5, height: 5)
      }
      if style == .pinned { Image(systemName: "pin").font(.system(size: 11)) }
    }
    .foregroundStyle(tone)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "Headroom, \(status.followed?.name ?? "all sources"), \(shown ?? "no readings yet"), \(model.unread) unread notifications"
    )
  }
}
