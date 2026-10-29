import HeadroomKit
import Observation
import SwiftUI
import WidgetKit

@MainActor
@Observable
final class AppModel {
  var sources: [SourceSnapshot] = []
  var error: String?
  private var poller: Poller?

  func start() async {
    do {
      let sources = try await SourceStore().load()
      let poller = try await Poller(
        sources: sources, vault: KeychainTokenVault(), notices: NoticeStore())
      self.poller = poller
      await poller.start()
      for await snapshots in await poller.updates() {
        self.sources = snapshots
        WidgetCenter.shared.reloadAllTimelines()
      }
    } catch { self.error = "Could not load sources." }
  }

  func setOpen(_ open: Bool) async { await poller?.setPopoverOpen(open) }
}

@main
@MainActor
struct HeadroomApp: App {
  @State private var model: AppModel

  init() {
    let model = AppModel()
    _model = State(initialValue: model)
    Task { await model.start() }
  }

  var body: some Scene {
    MenuBarExtra("Headroom", systemImage: "gauge.with.dots.needle.33percent") {
      VStack(alignment: .leading, spacing: 12) {
        Text("Headroom").font(.headline)
        if let error = model.error {
          Text(error)
        } else if model.sources.isEmpty {
          Text("No sources configured.").foregroundStyle(.secondary)
        }
        ForEach(model.sources) { source in
          HStack {
            Text(source.source.name)
            Spacer()
            Text(source.state.rawValue).foregroundStyle(.secondary)
          }
        }
      }
      .padding()
      .frame(width: 320)
      .task { await model.setOpen(true) }
      .onDisappear { Task { await model.setOpen(false) } }
    }
    .menuBarExtraStyle(.window)
  }
}
