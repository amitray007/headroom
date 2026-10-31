import AppKit
import HeadroomKit
import SwiftUI

/// The header's "0.2.0 available" capsule. It opens the update card; it never installs.
struct UpdateCapsule: View {
  let updater: AppUpdater
  let on: Bool
  let action: () -> Void

  var body: some View {
    if let update = updater.available {
      let updating = updater.install == .running
      Button(action: action) {
        HStack(spacing: 5) {
          if updating {
            AtomSpinner(size: 12)
          } else {
            Image(systemName: "arrow.down.circle").font(.system(size: 12, weight: .medium))
          }
          Text(updating ? "Updating…" : "\(update.version) available")
            .font(HR.popoverFont(11, .medium))
        }.padding(.horizontal, 9).frame(height: 24)
      }
      .buttonStyle(UpdateCapsuleStyle(on: on))
      .help(updating ? "Headroom is updating" : "Headroom \(update.version) is available")
      .accessibilityLabel(
        updating ? "Updating Headroom" : "Update available, Headroom \(update.version)"
      )
      .accessibilityValue(on ? "Open" : "Closed")
      .popoverMenuAnchor(.update)
    }
  }
}

private struct UpdateCapsuleStyle: ButtonStyle {
  var on = false
  func makeBody(configuration: Configuration) -> some View {
    CapsuleBody(configuration: configuration, on: on)
  }

  private struct CapsuleBody: View {
    let configuration: Configuration
    let on: Bool
    @State private var hovered = false
    var body: some View {
      configuration.label.foregroundStyle(HR.ink)
        .background(
          configuration.isPressed ? HR.track : hovered || on ? HR.muted : .clear, in: Capsule()
        )
        .overlay(Capsule().strokeBorder(HR.border))
        .scaleEffect(configuration.isPressed ? 0.97 : 1)
        .animation(Motion.press(configuration.isPressed), value: configuration.isPressed)
        .animation(Motion.hover, value: hovered)
        .onHover { hovered = $0 }
        .contentShape(Capsule())
    }
  }
}

/// The body of the update card: what is new, the one action, and what happens next.
struct UpdateCardContent: View {
  let updater: AppUpdater
  @State private var copied = false

  private static let textWidth: CGFloat = 236

  var body: some View {
    if let update = updater.available {
      VStack(alignment: .leading, spacing: 2) {
        Text("Headroom \(update.version)").font(HR.popoverFont(13, .medium))
          .foregroundStyle(HR.ink)
        Text(have(update.publishedAt)).font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
      }
      .padding(.horizontal, 8).padding(.top, 6).padding(.bottom, 4)
      .accessibilityElement(children: .combine)
      PopoverMenuItem(title: "What's new", symbol: "arrow.up.right.square") {
        NSWorkspace.shared.open(update.notesURL)
      }
      PopoverMenuDivider()
      action(update.notesURL)
    }
  }

  private func have(_ published: Date?) -> String {
    let released = published.map {
      " · released \($0.formatted(date: .abbreviated, time: .omitted))"
    }
    return "You have \(updater.running)\(released ?? "")"
  }

  @ViewBuilder private func action(_ release: URL) -> some View {
    switch updater.install {
    case .running:
      HStack(spacing: 8) {
        AtomSpinner(size: 14).frame(width: 16)
        Text("Updating…").font(HR.popoverFont(13)).foregroundStyle(HR.ink)
      }
      .padding(.horizontal, 8).frame(height: 28)
      .accessibilityElement(children: .combine).accessibilityLabel("Updating")
      note("Installing with Homebrew. Headroom reopens when it is done.")
    case .failed(let reason):
      Text(reason).font(HR.popoverFont(11)).foregroundStyle(HR.danger)
        .lineLimit(2).frame(width: Self.textWidth, alignment: .leading)
        .padding(.horizontal, 8).padding(.vertical, 4)
      PopoverMenuItem(title: "Try again", symbol: "arrow.clockwise") {
        updater.installWithHomebrew()
      }
      PopoverMenuItem(title: copied ? "Copied" : "Copy command", symbol: "doc.on.doc") {
        updater.copyCommand()
        copied = true
        Task {
          try? await Task.sleep(for: .seconds(2))
          copied = false
        }
      }
    case .idle:
      if updater.brew != nil {
        PopoverMenuItem(title: "Update now", symbol: "arrow.down.circle") {
          updater.installWithHomebrew()
        }
        note(
          "Updates with Homebrew, then reopens Headroom. Afterwards macOS asks for your login password once, to unlock saved tokens."
        )
      } else {
        PopoverMenuItem(title: "Download", symbol: "arrow.down.to.line") {
          NSWorkspace.shared.open(release)
        }
        note(
          "Homebrew was not found. Download the zip and replace Headroom in Applications. Afterwards macOS asks for your login password once, to unlock saved tokens."
        )
      }
    }
  }

  private func note(_ text: String) -> some View {
    Text(text).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
      .fixedSize(horizontal: false, vertical: true)
      .frame(width: Self.textWidth, alignment: .leading)
      .padding(.horizontal, 8).padding(.top, 4).padding(.bottom, 6)
  }
}
