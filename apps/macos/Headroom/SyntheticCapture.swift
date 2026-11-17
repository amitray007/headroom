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
          model.noticePhase = .ready
          for item in model.notices {
            await model.setRead(!["n1", "n2", "n3", "n5"].contains(item.notice.id), item: item)
          }
          for (state, name) in [
            ("capture", "home-popover"), ("expanded", "expanded-popover"), ("lower", "home-lower"),
          ] {
            model.captureState = state
            try await shot(
              PopoverView(model: model), name: "r6-\(name)-\(theme)-2x", size: nil,
              directory: directory)
          }
          model.captureState = "capture"
          if let first = model.notices.first { await model.setRead(true, item: first) }
          try await shot(
            PopoverView(model: model, notices: true), name: "r6-notices-\(theme)-2x", size: nil,
            directory: directory)
          model.captureState = "notice-expanded"
          try await shot(
            PopoverView(model: model, notices: true), name: "r6-notices-expanded-\(theme)-2x",
            size: nil, directory: directory)
          if let first = model.notices.first { await model.setRead(false, item: first) }
          for state in ["empty", "loading", "offline", "clear", "notice-loading", "notice-error"] {
            model.sources = saved
            model.captureState = state
            model.noticePhase = .ready
            switch state {
            case "empty": model.sources = []
            case "loading": model.sources = saved.map { SourceSnapshot(source: $0.source) }
            case "offline": model.sources[1].state = .offline
            case "clear": model.notices = []
            case "notice-loading": model.noticePhase = .loading
            case "notice-error": model.noticePhase = .failed
            default: break
            }
            let isNotices = ["clear", "notice-loading", "notice-error"].contains(state)
            try await shot(
              PopoverView(model: model, notices: isNotices),
              name: "r6-\(state == "empty" ? "states" : "state-" + state)-\(theme)-2x", size: nil,
              directory: directory)
            model.sources = saved
            await model.loadNotices()
          }
          for pane in SettingsPane.allCases {
            model.selectedPane = pane
            try await shot(
              SettingsView(model: model),
              name:
                "r6-settings-\(pane.rawValue.lowercased().replacingOccurrences(of: " ", with: "-"))-\(theme)-2x",
              size: NSSize(width: 700, height: 598), directory: directory,
              title: "Headroom Settings")
          }
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
        .clipShape(RoundedRectangle(cornerRadius: title == nil ? 16 : 0))
        .overlay {
          if title == nil {
            RoundedRectangle(cornerRadius: 16).strokeBorder(HR.border, lineWidth: 1)
          }
        }
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
      window.appearance = NSAppearance(named: name.contains("-dark") ? .darkAqua : .aqua)
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
      // Normalize the display profile so comparisons use the mockup's sRGB colors.
      if let image = NSBitmapImageRep(data: try Data(contentsOf: path)),
        let normalized = image.converting(to: .sRGB, renderingIntent: .default),
        let png = normalized.representation(using: .png, properties: [:])
      {
        try png.write(to: path)
      }
      window.close()
    }
    private enum CaptureError: Error { case image, readState }
  }
#endif
