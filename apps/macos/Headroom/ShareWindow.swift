import AppKit
import HeadroomKit
import Observation
import SwiftUI
import UniformTypeIdentifiers

/// What the open Share window holds. The controller replaces `selected` on every request; the
/// look comes from the display preferences each time.
@MainActor @Observable
final class ShareSession {
  var selected: Set<String> = []
  var options = ShareOptions()
}

/// Keeps the one Share window. Asking again brings it to the front with the new account pick.
@MainActor
final class ShareWindowController {
  private var window: NSWindow?
  private let session = ShareSession()

  func show(model: AppModel, accounts: Set<String>) {
    session.selected = accounts
    // Privacy Mode hides names and money for this session only; the saved look is untouched.
    session.options = model.preferences.share.applying(privacy: model.preferences.privacy)
    if window == nil {
      let host = NSHostingController(rootView: ShareView(model: model, session: session))
      let window = NSWindow(contentViewController: host)
      window.title = "Share Snapshot"
      window.styleMask = [.titled, .closable]
      window.isReleasedWhenClosed = false
      window.setContentSize(NSSize(width: 1000, height: 640))
      window.center()
      self.window = window
    }
    NSApp.activate()
    window?.makeKeyAndOrderFront(nil)
  }
}

/// The Share window: a live preview on the left, the choices on the right.
struct ShareView: View {
  let model: AppModel
  let session: ShareSession
  @State private var toast: String?
  @State private var toastTask: Task<Void, Never>?
  @State private var anchor = ShareAnchor()

  private var view: DisplayPreferences.LimitsView { model.preferences.limitsView }

  /// The same rows the popover builds, so the picture matches what it shows.
  private var rows: [LedgerRow] {
    RoomNow(items: model.popoverAccounts, now: model.now).columns.map {
      LedgerRow(column: $0, now: model.now, view: view)
    }
  }

  private func snapshot(_ rows: [LedgerRow]) -> ShareSnapshot {
    ShareSnapshot(
      rows: rows, selected: session.selected, options: session.options, now: model.now, view: view)
  }

  var body: some View {
    let rows = self.rows
    let snapshot = snapshot(rows)
    HStack(spacing: 0) {
      ShareStage(snapshot: snapshot, options: session.options, toast: toast)
      Rectangle().fill(HR.border).frame(width: 1)
      VStack(spacing: 0) {
        ScrollView {
          ShareChoices(rows: rows, session: session, snapshot: snapshot, change: change)
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)
        }.scrollIndicators(.never)
        actions(snapshot)
      }.frame(width: 300)
    }
    .font(HR.popoverFont(12.5)).foregroundStyle(HR.ink).background(HR.surface)
    .frame(width: 1000, height: 640)
  }

  /// The look changes in the open window and in the saved preferences together, so a choice
  /// forced by Privacy Mode never reaches the file unless the owner changes it.
  private func change(_ edit: (inout ShareOptions) -> Void) {
    edit(&session.options)
    var saved = model.preferences.share
    edit(&saved)
    guard saved != model.preferences.share else { return }
    model.preferences.share = saved
    model.saveDisplay()
  }

  // MARK: Actions

  private func actions(_ snapshot: ShareSnapshot) -> some View {
    let empty = snapshot.entries.isEmpty
    return HStack(spacing: 8) {
      Button {
        share(snapshot)
      } label: {
        Image(systemName: "square.and.arrow.up").font(.system(size: 13))
          .frame(width: 16, height: 16)
      }.buttonStyle(HRButtonStyle()).help("Share through AirDrop, Messages or Mail")
        .accessibilityLabel("Share").background(ShareAnchorView(anchor: anchor))
      Button("Save…") { save(snapshot) }.buttonStyle(HRButtonStyle())
        .accessibilityLabel("Save as PNG")
      Spacer(minLength: 0)
      Button {
        copy(snapshot)
      } label: {
        HStack(spacing: 6) {
          Text("Copy Image").font(HR.popoverFont(12.5, .medium))
          Text("⌘C").opacity(0.55)
        }
      }.buttonStyle(HRButtonStyle(selected: true)).keyboardShortcut("c", modifiers: .command)
        .accessibilityLabel("Copy image")
    }
    .font(HR.popoverFont(12.5, .medium)).disabled(empty).padding(.horizontal, 16)
    .padding(.vertical, 12)
    .overlay(alignment: .top) { Rectangle().fill(HR.border).frame(height: 1) }
  }

  /// The picture at 2x as PNG data. `nil` when it cannot be drawn.
  private func png(_ snapshot: ShareSnapshot) -> Data? {
    let renderer = ImageRenderer(content: ShareShot(snapshot: snapshot, options: session.options))
    renderer.scale = 2
    guard let image = renderer.cgImage else { return nil }
    return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
  }

  private var fileName: String {
    "headroom-\(model.now.formatted(Date.ISO8601FormatStyle(timeZone: .current).year().month().day())).png"
  }

  private func copy(_ snapshot: ShareSnapshot) {
    guard let data = png(snapshot) else { return fail() }
    let board = NSPasteboard.general
    board.clearContents()
    board.setData(data, forType: .png)
    // Apps that read only TIFF still get the picture.
    if let tiff = NSImage(data: data)?.tiffRepresentation { board.setData(tiff, forType: .tiff) }
    show("Copied")
  }

  private func save(_ snapshot: ShareSnapshot) {
    guard let data = png(snapshot) else { return fail() }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.png]
    panel.nameFieldStringValue = fileName
    panel.canCreateDirectories = true
    let name = fileName
    let finish: (NSApplication.ModalResponse) -> Void = { response in
      guard response == .OK, let url = panel.url else { return }
      do {
        try data.write(to: url, options: .atomic)
        show("Saved \(url.lastPathComponent)")
      } catch {
        show("Could not save \(name)")
      }
    }
    if let window = anchor.view?.window {
      panel.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(panel.runModal())
    }
  }

  private func share(_ snapshot: ShareSnapshot) {
    guard let data = png(snapshot), let view = anchor.view else { return fail() }
    // The picker takes a file, so the picture goes to the temporary folder first.
    let url = FileManager.default.temporaryDirectory.appending(path: fileName)
    do { try data.write(to: url, options: .atomic) } catch { return fail() }
    NSSharingServicePicker(items: [url]).show(
      relativeTo: view.bounds, of: view, preferredEdge: .minY)
  }

  // The popover shows `model.error`, and it is closed while this window is open, so a failure
  // shows in the window's own toast.
  private func fail() { show("Could not draw the picture") }

  private func show(_ text: String) {
    toastTask?.cancel()
    withAnimation(Motion.hover) { toast = text }
    toastTask = Task {
      try? await Task.sleep(for: .seconds(1.4))
      guard !Task.isCancelled else { return }
      withAnimation(Motion.view(false)) { toast = nil }
    }
  }
}

/// Finds the AppKit view behind the share button, which the sharing picker needs.
@MainActor
final class ShareAnchor {
  weak var view: NSView?
}

private struct ShareAnchorView: NSViewRepresentable {
  let anchor: ShareAnchor
  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    anchor.view = view
    return view
  }
  func updateNSView(_ view: NSView, context: Context) { anchor.view = view }
}

// MARK: - Stage

/// The dotted stage: the picture scaled to fit, its pixel size and the toast.
private struct ShareStage: View {
  let snapshot: ShareSnapshot
  let options: ShareOptions
  let toast: String?

  var body: some View {
    // Measured once per draw; the preview and the size line both read it.
    let metrics =
      snapshot.entries.isEmpty ? nil : ShareShot.metrics(snapshot: snapshot, options: options)
    VStack(spacing: 0) {
      GeometryReader { proxy in
        ZStack {
          Dots()
          if let metrics {
            let canvas = metrics.canvas
            let scale = min(
              1, (proxy.size.width - 48) / canvas.width, (proxy.size.height - 48) / canvas.height)
            ShareShot(snapshot: snapshot, options: options, metrics: metrics)
              .scaleEffect(scale)
              .frame(width: canvas.width * scale, height: canvas.height * scale)
              .accessibilityElement(children: .ignore)
              .accessibilityLabel("Preview of the snapshot")
          } else {
            Text("Pick at least one account").foregroundStyle(HR.textMuted)
          }
        }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
      }
      Text(
        metrics.map { "PNG · \(Int($0.canvas.width * 2)) × \(Int($0.canvas.height * 2)) px" } ?? ""
      ).font(HR.popoverFont(11.5)).foregroundStyle(HR.secondary).frame(height: 40)
    }
    .background(HR.muted)
    .overlay(alignment: .bottom) {
      if let toast {
        Text(toast).font(HR.popoverFont(12, .medium)).foregroundStyle(HR.surface)
          .padding(.horizontal, 14).padding(.vertical, 7)
          .background(HR.ink, in: Capsule())
          .padding(.bottom, 54).transition(.opacity.combined(with: .offset(y: 8)))
      }
    }
  }
}

private struct Dots: View {
  var body: some View {
    Canvas { context, size in
      for x in stride(from: CGFloat(7), to: size.width, by: 14) {
        for y in stride(from: CGFloat(7), to: size.height, by: 14) {
          context.fill(
            Path(ellipseIn: CGRect(x: x - 0.8, y: y - 0.8, width: 1.6, height: 1.6)),
            with: .color(HR.border))
        }
      }
    }.accessibilityHidden(true)
  }
}
