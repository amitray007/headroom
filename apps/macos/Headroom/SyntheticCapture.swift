#if DEBUG
  import AppKit
  import HeadroomKit
  import SwiftUI

  /// Debug-only verification. Every source uses the committed synthetic feed and temporary stores.
  /// The normal application never reads capture flags, fixtures or these rendering paths in Release.
  @MainActor enum SyntheticCapture {
    static func run(model: AppModel, directory: URL) async {
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        NSApp.setActivationPolicy(.regular)
        let saved = model.sources
        model.captureState = "capture"
        for appearance in [DisplayPreferences.Appearance.light, .dark] {
          model.preferences.appearance = appearance
          let theme = appearance.rawValue
          model.sources = saved
          try await shot(
            PopoverView(model: model), name: "popover-\(theme)", size: nil, directory: directory)
          try await shot(
            MenuItemLabel(model: model, style: .logoAndPercentage).padding(12).background(
              HR.surface),
            name: "item-\(theme)", size: NSSize(width: 180, height: 48), directory: directory)
          try await shot(
            PopoverView(model: model, notices: true), name: "notices-\(theme)", size: nil,
            directory: directory)
          if let item = model.notices.first {
            await model.setRead(true, item: item)
            try await shot(
              NoticeDetail(model: model, item: item) {}, name: "notice-detail-\(theme)",
              size: NSSize(width: 460, height: 300), directory: directory)
            await model.setRead(false, item: item)
          }
          for pane in SettingsPane.allCases {
            model.selectedPane = pane
            try await shot(
              SettingsView(model: model),
              name:
                "settings-\(pane.rawValue.lowercased().replacingOccurrences(of: " ", with: "-"))-\(theme)",
              size: NSSize(width: 700, height: 598), directory: directory,
              title: "Headroom Settings")
          }
          try await shot(
            SourceEditor(model: model, draft: SourceDraft()) {}, name: "source-add-\(theme)",
            size: NSSize(width: 440, height: 310), directory: directory)
          for state in [
            "no-sources", "loading", "offline", "signed-out", "all-clear", "no-accounts",
          ] {
            model.sources = saved
            model.captureState = state
            switch state {
            case "no-sources": model.sources = []
            case "loading":
              model.sources = saved.map { SourceSnapshot(source: $0.source) }
            case "offline": model.sources[1].state = .offline
            case "signed-out": model.sources[1].state = .signedOut
            case "no-accounts":
              var snapshot = saved[0]
              snapshot.cached?.feed.accounts = []
              snapshot.cached?.feed.notices = []
              model.sources = [snapshot]
            case "all-clear":
              var snapshot = saved[0]
              let clearAccounts =
                snapshot.cached?.feed.accounts.filter { account in
                  account.state == .ready && !account.limits.isEmpty
                    && account.limits.allSatisfy {
                      ($0.percentLeft ?? 0) > 20 && $0.runsOutAt == nil
                    }
                } ?? []
              snapshot.cached?.feed.accounts = clearAccounts
              snapshot.cached?.feed.notices = []
              model.sources = [snapshot]
            default: break
            }
            await model.loadNotices()
            try await shot(
              PopoverView(model: model), name: "state-\(state)-\(theme)", size: nil,
              directory: directory)
          }
          model.sources = saved
          model.captureState = "capture"
          await model.loadNotices()
          let notices = model.notices
          model.notices = []
          try await shot(
            NoticesView(model: model) {}, name: "no-notices-\(theme)",
            size: NSSize(width: 420, height: 380), directory: directory)
          model.notices = notices
        }
        model.sources = saved
        model.captureState = "capture"
        let before = model.unread
        if let first = model.notices.first(where: { !$0.read }) {
          await model.setRead(true, item: first)
          guard model.unread == before - 1 else { throw CaptureError.readState }
          await model.setRead(false, item: first)
          guard model.unread == before else { throw CaptureError.readState }
        }
        await model.markAllRead()
        guard model.unread == 0 else { throw CaptureError.readState }
        let result =
          "Synthetic capture complete. Notice flow: open decrements unread; mark unread restores it; mark all read gives zero.\n"
        try result.write(
          to: directory.appending(path: "capture-result.txt"), atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
      } catch {
        try? "Capture failed: \(error)".write(
          to: directory.appending(path: "capture-error.txt"), atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
      }
    }

    private static func shot<Content: View>(
      _ content: Content, name: String, size: NSSize?, directory: URL, title: String? = nil
    ) async throws {
      let view = content.font(HR.font()).foregroundStyle(HR.ink).background(HR.surface)
      let host = NSHostingView(rootView: view)
      let measured = size ?? host.fittingSize
      let window = NSWindow(
        contentRect: NSRect(origin: .zero, size: measured),
        styleMask: title == nil ? [.borderless] : [.titled, .closable, .miniaturizable],
        backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.title = title ?? "Headroom synthetic capture"
      window.contentView = host
      window.setContentSize(measured)
      window.appearance = NSAppearance(named: name.hasSuffix("dark") ? .darkAqua : .aqua)
      window.center()
      window.makeKeyAndOrderFront(nil)
      NSApp.activate()
      host.layoutSubtreeIfNeeded()
      try await Task.sleep(for: .milliseconds(350))
      let path = directory.appending(path: "\(name).png")
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
      process.arguments = ["-x", "-o", "-l", String(window.windowNumber), path.path]
      try process.run()
      process.waitUntilExit()
      if process.terminationStatus != 0 {
        // Caching the real NSHostingView also includes native controls, unlike ImageRenderer.
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
          throw CaptureError.image
        }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
          throw CaptureError.image
        }
        try data.write(to: path)
      }
      window.close()
    }
    private enum CaptureError: Error { case image, readState }
  }
#endif
