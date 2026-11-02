import AppKit
import HeadroomKit
import SwiftUI

/// Settings, Sources: Headroom on this Mac.
extension SettingsView {
  /// The anchor id of the managed server's ⋯ button, which has no source of its own.
  static let thisMacMenu = UUID(uuidString: "00000000-0000-4000-8000-00000000AAC0")!

  /// The This Mac source belongs to this group only while a server is installed here. Without
  /// one, a source at 127.0.0.1:8080 is a tunnel and stays in Other servers.
  func isThisMac(_ snapshot: SourceSnapshot) -> Bool {
    model.localOwner != nil && snapshot.source.baseURL == LocalServer.url
  }

  @ViewBuilder var thisMac: some View {
    switch model.localOwner {
    case .app:
      thisMacRow
      SettingsRow(title: "Keep running when the menu bar app quits") {
        Toggle(
          "Keep running when the menu bar app quits", isOn: $model.preferences.keepServerRunning
        )
        .toggleStyle(WebSwitchStyle())
      }
    case .homebrew, .other:
      if let index = model.sources.firstIndex(where: isThisMac) {
        sourceRow(
          model.sources[index], index: index,
          note: model.localOwner == .homebrew ? "Installed with Homebrew" : "Installed on this Mac")
      } else {
        thisMacRow
      }
    case nil:
      SettingsRow(title: "Set up on this Mac", note: "Runs here and starts at login.") {
        Button("Set up") { model.showSetup(.install) }
          .buttonStyle(WebButtonStyle(small: true)).disabled(model.busy)
      }
    }
  }

  private var thisMacRow: some View {
    HStack(spacing: 40) {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          Text("This Mac").font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink)
          HStack(spacing: 5) {
            Circle().fill(model.localAvailable ? HR.popoverSuccess : HR.popoverDanger)
              .frame(width: 6, height: 6)
            Text(status)
          }.font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
        }
        if !detail.isEmpty {
          Text(detail).font(HR.popoverFont(12)).foregroundStyle(HR.textMuted).lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
      HStack(spacing: 6) {
        mainAction
        if model.localOwner == .app {
          moreButton(id: Self.thisMacMenu, label: "More for Headroom on this Mac")
        }
      }
    }.padding(.vertical, 10)
  }

  private var status: String {
    if model.localBusy || model.localStarting { return "Working…" }
    guard model.localAvailable else { return "Stopped" }
    return model.localOwner == .app ? "Running · starts at login" : "Running"
  }

  /// "v0.1.15 · Updated 1 min ago".
  private var detail: String {
    var parts: [String] = []
    if let version = model.localVersion { parts.append("v\(version)") }
    if let snapshot = model.thisMacSource, model.localAvailable {
      parts.append("Updated \(Formatting.age(model.readAt(snapshot), now: model.now))")
    }
    return parts.joined(separator: " · ")
  }

  @ViewBuilder private var mainAction: some View {
    if !model.localAvailable {
      Button("Start it") { Task { await model.startLocal() } }
        .buttonStyle(WebButtonStyle(small: true)).disabled(model.localStarting || model.localBusy)
    } else if let source = model.thisMacSource, source.state != .signedOut {
      Button {
        model.openConnectPage(LocalServer.url)
      } label: {
        Label("Open dashboard", systemImage: "arrow.up.right").labelStyle(TrailingIcon())
      }.buttonStyle(WebButtonStyle(small: true))
    } else {
      Button("Connect") { model.showSetup(.connect) }.buttonStyle(WebButtonStyle(small: true))
    }
  }

  @ViewBuilder var thisMacMenuItems: some View {
    menuItem("Restart Headroom", "arrow.clockwise") { Task { await model.restartLocal() } }
    menuItem(
      model.localAvailable ? "Stop Headroom" : "Start Headroom",
      model.localAvailable ? "stop.circle" : "play.circle"
    ) {
      Task { await model.localAvailable ? model.stopLocal() : model.startLocal() }
    }
    menuItem("Show in Finder", "folder") { model.revealLocalData() }
    PopoverMenuDivider()
    menuItem("Copy details for support", "doc.on.doc") {
      Task { await model.copySupportDetails() }
    }
    PopoverMenuDivider()
    menuItem("Remove from this Mac…", "trash") { confirmRemoveThisMac() }
  }

  private func menuItem(_ title: String, _ symbol: String, action: @escaping () -> Void)
    -> some View
  {
    PopoverMenuItem(title: title, symbol: symbol) {
      closeSourceMenu()
      action()
    }
  }

  private func confirmRemoveThisMac() {
    let alert = NSAlert()
    alert.messageText = "Remove Headroom from this Mac?"
    alert.informativeText =
      "Headroom stops and no longer starts at login. Your accounts and readings stay on this Mac unless you tick the box."
    alert.addButton(withTitle: "Remove").hasDestructiveAction = true
    alert.addButton(withTitle: "Cancel")
    alert.showsSuppressionButton = true
    alert.suppressionButton?.title = "Also delete Headroom's data on this Mac"
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let deleteData = alert.suppressionButton?.state == .on
    Task { await model.removeLocal(deleteData: deleteData) }
  }
}
