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
