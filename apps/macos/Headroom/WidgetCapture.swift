#if DEBUG
  import AppKit
  import HeadroomKit
  import SwiftUI

  @MainActor enum WidgetCapture {
    static func run(directory: URL) {
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let url = Bundle.main.url(forResource: "widgets", withExtension: "json") else {
          throw CocoaError(.fileReadNoSuchFile)
        }
        let original = try JSONDecoder().decode(WidgetCache.self, from: Data(contentsOf: url))
        let now = original.writtenAt
        let zone = TimeZone(secondsFromGMT: 0)!
        var count = 0
        for scheme in [ColorScheme.light, .dark] {
          NSApp.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
          for appearance in ["colour", "dim", "tinted"] {
            for kind in WidgetKind.allCases {
              for state in [
                "ready", "stale", "offline", "no-data", "no-sources", "no-accounts", "signed-out",
                "run-out", "reset",
              ] {
                let date =
                  state == "stale"
                  ? now.addingTimeInterval(7200)
                  : state == "run-out"
                    ? now.addingTimeInterval(20 * 3600 + 40 * 60)
                    : state == "reset" ? now.addingTimeInterval(3900) : now
                let cache: WidgetCache? =
                  switch state {
                  case "no-data": nil
                  case "no-sources": WidgetCache.captureEmpty(original, noSources: true)
                  case "no-accounts": WidgetCache.captureEmpty(original, noSources: false)
                  case "offline", "signed-out":
                    try modified(
                      original, state: state == "offline" ? "offline" : "signedOut", now: now)
                  default: original
                  }
                let selected =
                  kind == .account
                  ? [
                    state == "offline" || state == "signed-out"
                      ? "work:codex-work" : "home:claude-side"
                  ]
                  : kind == .accounts
                    ? ["home:claude-side", "home:claude-max", "work:codex-work"] : []
                let view = Group {
                  if appearance == "tinted" {
                    HeadroomWidgetPresentation(
                      cache: cache, date: date, kind: kind,
                      accountIDs: selected, timeZone: zone
                    )
                    .environment(\.widgetRenderingMode, .accented)
                  } else {
                    HeadroomWidgetView(
                      cache: cache, date: date, kind: kind,
                      accountIDs: selected, dim: appearance == "dim", timeZone: zone)
                  }
                }
                .frame(width: kind.size.width, height: kind.size.height)
                .environment(\.colorScheme, scheme)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                guard let image = renderer.nsImage,
                  let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:])
                else {
                  throw CocoaError(.fileWriteUnknown)
                }
                let name =
                  "\(kind.rawValue)-\(state)-\(appearance)-\(scheme == .dark ? "dark" : "light").png"
                try png.write(to: directory.appending(path: name))
                count += 1
              }
            }
          }
        }
        try
          "\(count) synthetic widget ImageRenderer captures at 2x. Five layouts, nine states, colour/dim/tinted, light/dark. Tinted captures exercise the image branch; system rendering still needs an owner check.\n"
          .write(
            to: directory.appending(path: "capture-result.txt"), atomically: true, encoding: .utf8)
      } catch {
        try? "Capture failed: \(error)".write(
          to: directory.appending(path: "capture-error.txt"), atomically: true, encoding: .utf8)
      }
      NSApp.terminate(nil)
    }

    private static func modified(_ cache: WidgetCache, state: String, now: Date) throws
      -> WidgetCache
    {
      // Mutate serialized display fixtures only. Production caches are never read or changed.
      let data = try JSONEncoder().encode(cache)
      var object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
      var rows = (object["rows"] as! [[String: Any]]).filter {
        $0["id"] as? String == "work:codex-work"
      }
      let old = now.addingTimeInterval(-7200).timeIntervalSinceReferenceDate
      for index in rows.indices {
        rows[index]["state"] = state
        rows[index]["observedAt"] = old
      }
      object["rows"] = rows
      object["sources"] = [["name": "Work server", "state": state]]
      return try JSONDecoder().decode(
        WidgetCache.self, from: JSONSerialization.data(withJSONObject: object))
    }
  }

  extension WidgetCache {
    fileprivate static func captureEmpty(_ cache: WidgetCache, noSources: Bool) -> WidgetCache {
      WidgetCache(writtenAt: cache.writtenAt, rows: [], sources: noSources ? [] : cache.sources)
    }
  }
#endif
