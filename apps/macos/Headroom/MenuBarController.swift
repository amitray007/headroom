import AppKit
import Observation
import SwiftUI

/// MenuBarExtra has no public presentation binding. Banner navigation needs to open the
/// popover, so ADR 0004's NSStatusItem fallback owns presentation; the content stays SwiftUI.
@MainActor
final class MenuBarController: NSObject, NSPopoverDelegate {
  private let model: AppModel
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let popover = NSPopover()
  private var appearance: NSKeyValueObservation?

  init(model: AppModel) {
    self.model = model
    super.init()
    popover.behavior = .transient
    popover.delegate = self
    let host = NSHostingController(rootView: PopoverView(model: model))
    // The popover only needs its preferred size. The default options also work out a minimum,
    // a maximum and an intrinsic size, each a full layout pass after every redraw.
    host.sizingOptions = [.preferredContentSize]
    popover.contentViewController = host
    if let button = item.button {
      button.target = self
      button.action = #selector(toggle)
      button.imagePosition = .imageOnly
      // A light or dark menu bar needs the colored label drawn again.
      appearance = button.observe(\.effectiveAppearance) { [weak self] _, _ in
        Task { @MainActor in self?.drawLabel() }
      }
    }
    observe()
  }

  func popoverDidShow(_ notification: Notification) {
    // NSPopover animates every content size change when `animates` is on, and SwiftUI lays the
    // whole popover out again on each frame of it. Keep the open animation, then size instantly.
    popover.animates = false
    Task { await model.setOpen(true) }
  }
  func popoverDidClose(_ notification: Notification) { Task { await model.setOpen(false) } }

  @objc private func toggle() {
    if popover.isShown { popover.performClose(nil) } else { show() }
  }
  private func show() {
    guard let button = item.button else { return }
    popover.animates = true
    popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    popover.contentViewController?.view.window?.makeKey()
  }
  private func observe() {
    withObservationTracking {
      _ = model.sources
      _ = model.preferences
      _ = model.notices
      _ = model.now
      _ = model.ready
      _ = model.popoverPresented
      drawLabel()
      if model.popoverPresented {
        if popover.isShown { Task { await model.presentBannerNotice() } } else { show() }
        // The flag is an open request. Closing the popover does not change the unread dot.
        Task { self.model.popoverPresented = false }
      }
    } onChange: { [weak self] in
      Task { @MainActor in self?.observe() }
    }
  }
}

extension MenuBarController {
  /// The label is drawn once into an image when it changes. A live SwiftUI view in the status
  /// item made macOS lay it out again for every menu bar snapshot (each display and Space),
  /// up to 300 ms on the main thread. A one-color label is a template image the menu bar
  /// tints itself; a colored one is drawn for the menu bar's current appearance.
  fileprivate func drawLabel() {
    guard let button = item.button else { return }
    let status = MenuStatus(model: model, style: model.preferences.itemStyle)
    let monochrome = !status.colored
    let dark =
      !monochrome && button.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    let renderer = ImageRenderer(
      content: MenuItemLabel(status: status)
        .frame(height: 24).environment(\.colorScheme, dark ? .dark : .light))
    renderer.scale = button.window?.backingScaleFactor ?? 2
    guard let image = renderer.nsImage else { return }
    image.isTemplate = monochrome
    // The image carries no accessibility, so the button reads what the label shows.
    button.setAccessibilityLabel(status.summary)
    // The item keeps its variable length, so the menu bar pads it like every other icon. A
    // fixed width with 4 pt per side left 6 pt more space after it than between other icons.
    button.image = image
  }
}
