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
  private var label: MenuLabelHost?

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
      let label = MenuLabelHost(
        rootView: MenuItemLabel(model: model, style: model.preferences.itemStyle))
      button.addSubview(label)
      self.label = label
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
      label?.rootView = MenuItemLabel(model: model, style: model.preferences.itemStyle)
      let size = label?.fittingSize ?? NSSize(width: 24, height: 24)
      // 4 pt each side, as a standard 16 pt menu bar icon sits in its 24 pt item.
      item.length = size.width + 8
      label?.frame = NSRect(x: 4, y: 0, width: size.width, height: 24)
      item.button?.setAccessibilityLabel("Headroom, \(model.unread) unread notifications")
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

private final class MenuLabelHost: NSHostingView<MenuItemLabel> {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
