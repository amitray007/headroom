import AppKit
import HeadroomKit
import SwiftUI

/// Keeps the one Set Up Headroom window. Closing it cancels the pairing; an install that is
/// already running finishes without opening the browser.
@MainActor
final class SetupWindowController: NSObject, NSWindowDelegate {
  private var window: NSWindow?
  private var flow: SetupFlow?

  func show(model: AppModel, mode: SetupFlow.Mode) {
    if let window, let flow, flow.mode == mode, !flow.finished {
      NSApp.activate()
      window.makeKeyAndOrderFront(nil)
      return
    }
    close()
    let flow = SetupFlow(mode: mode)
    self.flow = flow
    let window = NSWindow(
      contentViewController: NSHostingController(rootView: SetupView(model: model, flow: flow)))
    window.title = "Set Up Headroom"
    window.styleMask = [.titled, .closable]
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.center()
    self.window = window
    NSApp.activate()
    window.makeKeyAndOrderFront(nil)
    Task { await flow.run(model: model) }
  }

  private func close() {
    flow?.close()
    window?.delegate = nil
    window?.close()
    window = nil
  }

  func windowWillClose(_ notification: Notification) {
    flow?.close()
    window = nil
  }
}

struct SetupView: View {
  let model: AppModel
  let flow: SetupFlow
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    VStack(spacing: 0) {
      SetupTrack(stage: flow.stage)
      Rectangle().fill(HR.border).frame(height: 1)
      VStack(alignment: .leading, spacing: 12) { content }
        .padding(.horizontal, 28).padding(.top, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      HStack(spacing: 12) { footer }
        .padding(.horizontal, 28).frame(height: 64)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .overlay(alignment: .top) { Rectangle().fill(HR.border).frame(height: 1) }
    }
    .font(HR.popoverFont(14)).foregroundStyle(HR.ink).background(HR.raisedSurface)
    .frame(width: 460, height: 380)
  }

  // MARK: Body

  @ViewBuilder private var content: some View {
    if flow.finished {
      done
    } else if flow.installing || flow.failure != nil {
      install
    } else {
      pairing
    }
  }

  private func heading(_ title: String, _ line: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(HR.popoverFont(18, .medium)).accessibilityAddTraits(.isHeader)
      if let line {
        Text(line).font(HR.popoverFont(13)).foregroundStyle(HR.secondary).lineSpacing(2)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var install: some View {
    VStack(alignment: .leading, spacing: 18) {
      if let failure = flow.failure {
        heading(
          failure.step == .place
            ? "Headroom could not be put in place" : "Headroom could not start",
          failure.detail.isEmpty ? nil : failure.detail)
      } else {
        heading("Setting up Headroom", "You can close this window. Setup keeps going.")
      }
      VStack(alignment: .leading, spacing: 10) {
        ForEach(ManagedServer.Step.allCases, id: \.self) { step in
          SetupCheck(title: step.title, state: flow.state(of: step))
        }
      }
    }
  }

  @ViewBuilder private var pairing: some View {
    let fresh = flow.mode == .install
    switch flow.pairing.state {
    case .idle, .starting, .waiting, .saving:
      heading(
        fresh ? "Finish in your browser" : "Approve this Mac",
        fresh
          ? "Create your account there. This window moves on by itself."
          : "Press Allow there. This window moves on by itself.")
      PairingCodeBox(state: flow.pairing.state)
    case .denied:
      heading("This Mac was not allowed", "Nothing was connected.")
    case .expired:
      heading("The code expired", "Nothing was connected.")
    case .tooOld:
      heading("This Headroom cannot pair yet", "Update it, or use a token.")
    case .failed(let message):
      heading("Headroom did not answer", message)
    }
  }

  private var done: some View {
    VStack(alignment: .leading, spacing: 18) {
      Image(systemName: "checkmark").font(.system(size: 18, weight: .semibold))
        .foregroundStyle(HR.background).frame(width: 40, height: 40)
        .background(HR.ink, in: Circle()).accessibilityHidden(true)
      heading(
        "Headroom is ready",
        flow.mode == .install
          ? "It runs on this Mac and starts when you log in. Connect your AI accounts in the dashboard."
          : "Connect your AI accounts in the dashboard.")
    }
  }

  // MARK: Footer

  @ViewBuilder private var footer: some View {
    if flow.finished {
      Button("Done") { NSApp.keyWindow?.close() }.buttonStyle(WebButtonStyle())
      Button("Open dashboard") {
        model.openConnectPage(LocalServer.url)
      }.buttonStyle(WebButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
    } else if let failure = flow.failure {
      Button("Copy details for support") {
        Task { await model.copySupportDetails(failure: failure) }
      }.buttonStyle(WebButtonStyle(kind: .quiet))
      Button("Try again") { flow.retry(model: model) }
        .buttonStyle(WebButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
    } else if !flow.installing {
      pairingFooter
    }
  }

  @ViewBuilder private var pairingFooter: some View {
    switch flow.pairing.state {
    case .denied, .expired, .failed:
      Button("Start over") { flow.retry(model: model) }
        .buttonStyle(WebButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
    case .tooOld:
      Link("How to update", destination: ServerCompatibility.updateGuide)
        .buttonStyle(WebButtonStyle())
      useToken
    default:
      if flow.mode == .connect { useToken }
      Button("Open it again") { flow.pairing.openPage() }
        .buttonStyle(WebButtonStyle(kind: .primary)).disabled(!flow.pairing.waiting)
    }
  }

  private var useToken: some View {
    Button("Use a token instead") {
      flow.close()
      NSApp.keyWindow?.close()
      model.requestSourceSheet(.localToken, openSettings)
    }.buttonStyle(WebButtonStyle(kind: .quiet))
  }
}

/// Install, Create account, Connect accounts.
private struct SetupTrack: View {
  let stage: Int
  private let names = ["Install", "Create account", "Connect accounts"]

  var body: some View {
    HStack(spacing: 0) {
      ForEach(Array(names.enumerated()), id: \.offset) { index, name in
        HStack(spacing: 6) {
          if index < stage {
            Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold))
          }
          Text(name)
        }
        .font(HR.popoverFont(12, index == stage ? .medium : .regular))
        .foregroundStyle(index == stage ? HR.ink : index < stage ? HR.secondary : HR.textMuted)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(index == stage ? .isSelected : [])
      }
    }.frame(height: 44)
  }
}

private struct SetupCheck: View {
  let title: String
  let state: SetupFlow.StepState

  var body: some View {
    HStack(spacing: 10) {
      mark.frame(width: 18, height: 18)
      Text(title).foregroundStyle(state == .waiting ? HR.textMuted : HR.ink)
    }
    .font(HR.popoverFont(13))
    .accessibilityElement(children: .combine)
    .accessibilityValue(spoken)
  }

  private var spoken: String {
    switch state {
    case .waiting: "Waiting"
    case .running: "Running"
    case .done: "Done"
    case .failed: "Failed"
    }
  }

  @ViewBuilder private var mark: some View {
    switch state {
    case .waiting: Circle().strokeBorder(HR.borderStrong, lineWidth: 1.5)
    case .running: ProgressView().controlSize(.small)
    case .done:
      Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
        .foregroundStyle(HR.background).frame(width: 18, height: 18)
        .background(HR.ink, in: Circle())
    case .failed:
      Text("!").font(HR.popoverFont(11, .semibold)).foregroundStyle(.white)
        .frame(width: 18, height: 18).background(HR.danger, in: Circle())
    }
  }
}

/// The code the browser shows too, so the owner can tell the two screens belong together.
struct PairingCodeBox: View {
  let state: PairingSession.State

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Same code in the browser").font(HR.popoverFont(12)).foregroundStyle(HR.textMuted)
      Text(code ?? "· · ·")
        .font(.system(size: 26, weight: .medium, design: .monospaced)).tracking(3)
        .frame(maxWidth: .infinity).frame(height: 64)
        .background(HR.muted, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(HR.border))
        .textSelection(.enabled)
        .accessibilityLabel(code.map { "Code \($0)" } ?? "Waiting for a code")
    }
  }

  private var code: String? {
    if case .waiting(let code) = state { return code }
    return nil
  }
}
