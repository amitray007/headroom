import HeadroomKit
import SwiftUI

/// The popover before any source: set up Headroom here, or connect to the one already here.
struct NoSourcesState: View {
  let model: AppModel
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    if model.localOwner != nil {
      PopoverState(
        art: "no-sources", title: "Headroom is on this Mac",
        message: model.localAvailable
          ? "This app is not connected to it yet." : "It is not running."
      ) {
        HStack(spacing: 14) {
          if model.localAvailable {
            Button("Connect") { model.showSetup(.connect) }.buttonStyle(PopoverActionStyle())
          } else {
            Button(model.localStarting ? "Starting…" : "Start Headroom") {
              Task { await model.startLocal() }
            }.buttonStyle(PopoverActionStyle()).disabled(model.localStarting)
          }
          Button("Use another server") { model.requestSourceSheet(.addServer, openSettings) }
            .buttonStyle(.plain)
        }
      }
    } else {
      PopoverState(
        art: "no-sources", title: "Set up Headroom",
        message: "See how much of your AI plans is left. Headroom runs on this Mac."
      ) {
        HStack(spacing: 14) {
          Button("Set up on this Mac") { model.showSetup(.install) }
            .buttonStyle(PopoverActionStyle())
          Button("I already have a Headroom server") {
            model.requestSourceSheet(.addServer, openSettings)
          }.buttonStyle(.plain)
        }
      }
    }
  }
}

/// A connected source with no AI account yet: the dashboard page that connects one.
struct NoAccountsState: View {
  let model: AppModel

  var body: some View {
    PopoverState(
      art: "connect-account", title: "Connect your first AI account",
      message: "Add one in the dashboard. It shows here within a minute."
    ) {
      VStack(spacing: 14) {
        HStack(spacing: 14) {
          ForEach(["claude", "codex", "cursor", "grok"], id: \.self) { provider in
            ProviderMark(provider: provider).frame(width: 18, height: 18)
          }
        }.accessibilityHidden(true)
        if let source = model.popoverSources.first?.source {
          Button {
            model.openConnectPage(source.baseURL)
          } label: {
            Label("Open dashboard", systemImage: "arrow.up.right").labelStyle(TrailingIcon())
          }.buttonStyle(PopoverActionStyle())
        }
      }
    }
  }
}

/// The popover's note button when Headroom on this Mac stopped.
struct StartItButton: View {
  let model: AppModel

  var body: some View {
    Button("Start it") { Task { await model.startLocal() } }
      .buttonStyle(PopoverFooterStyle()).fixedSize().disabled(model.localStarting)
  }
}
