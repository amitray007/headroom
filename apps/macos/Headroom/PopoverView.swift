import AppKit
import HeadroomKit
import SwiftUI

struct PopoverView: View {
  @Bindable var model: AppModel
  @Environment(\.openSettings) private var openSettings
  @State private var showingNotices = false

  init(model: AppModel, notices: Bool = false) {
    self.model = model
    _showingNotices = State(initialValue: notices)
  }

  private var room: RoomNow { RoomNow(items: model.accounts, now: model.now) }
  private var loading: Bool {
    model.sources.isEmpty
      ? !model.ready : model.accounts.isEmpty && model.sources.contains { $0.state == .noData }
  }

  var body: some View {
    VStack(spacing: 0) {
      if showingNotices {
        NoticesView(model: model) { showingNotices = false }
      } else {
        header
        if loading {
          loadingContent
        } else if model.sources.isEmpty {
          PopoverState(
            art: "no-sources", title: "No sources yet",
            message:
              "Connect a Headroom source in Settings.\nAccounts and their room will appear here."
          ) {
            Button("Open Settings", action: settings).buttonStyle(.plain).font(HR.popoverFont(12))
          }
        } else if model.accounts.isEmpty {
          emptyAccounts
        } else {
          RoomChart(room: room, now: model.now)
            .padding(.horizontal, 16).padding(.bottom, 12)
          Divider().overlay(HR.border)
          ForEach(model.sources.filter { $0.state != .connected }) { snapshot in
            Text(sourceNote(snapshot)).font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
              .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
              .padding(.vertical, 10).padding(.horizontal, 16)
            Divider().overlay(HR.border)
          }
          accountList
        }
      }
      footer
    }
    .font(HR.popoverFont()).monospacedDigit().foregroundStyle(HR.ink).background(HR.surface)
    .frame(width: 420).preferredColorScheme(model.colorScheme)
    .task { if model.bannerNoticeID != nil { showingNotices = true } }
    .onChange(of: model.bannerNoticeID) { _, id in if id != nil { showingNotices = true } }
    .alert(
      "Headroom",
      isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
    ) {
      Button("OK") { model.error = nil }
    } message: {
      Text(model.error ?? "")
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      HeadroomGlyph().frame(width: 23, height: 23)
      Text("Headroom").font(HR.popoverFont(16, .medium)).accessibilityAddTraits(.isHeader)
      Spacer()
      if !loading && !model.sources.isEmpty {
        Button {
          Task { await model.readSources() }
        } label: {
          Image(systemName: "arrow.clockwise").font(.system(size: 16))
        }.buttonStyle(PopoverToolStyle()).help("Read sources")
          .accessibilityLabel("Read sources")
        Button {
          showingNotices = true
        } label: {
          HStack(spacing: 5) {
            Image(systemName: "bell").font(.system(size: 16))
            if model.noticePhase == .ready && !model.notices.isEmpty {
              Text("\(model.unread)").font(HR.popoverFont(12))
            }
          }
        }.buttonStyle(PopoverToolStyle()).accessibilityLabel("Notices, \(model.unread) unread")
      }
      Button(action: settings) { Image(systemName: "gearshape").font(.system(size: 16)) }
        .buttonStyle(PopoverToolStyle()).help("Open Settings").accessibilityLabel("Open Settings")
        .contextMenu { Button("Quit Headroom") { NSApp.terminate(nil) } }
    }.padding(.horizontal, 16).frame(height: 52)
  }

  private func settings() {
    NSApp.activate()
    openSettings()
  }

  private var accountList: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
          Section {
            ForEach(providers, id: \.self) { provider in
              ProviderSection(
                provider: provider,
                columns: room.columns.filter { $0.item.account.provider.rawValue == provider },
                model: model
              )
              .id(provider)
              if provider != providers.last { Divider().overlay(HR.border) }
            }
          } header: {
            HStack(spacing: 8) {
              Spacer()
              Text("Left").frame(width: 62, alignment: .trailing)
              Text("Resets").frame(width: 84, alignment: .trailing)
            }.font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
              .padding(.top, 7).padding(.bottom, 12).background(HR.surface)
              .overlay(alignment: .bottom) {
                Rectangle().fill(HR.surface).frame(height: 8).offset(y: 8)
              }
          }
        }.padding(.horizontal, 16)
      }.frame(height: 482)
        .onAppear {
          if model.synthetic && model.captureState == "lower" {
            proxy.scrollTo(providers.last, anchor: .bottom)
          }
        }
    }
  }
  private var providers: [String] {
    room.columns.reduce(into: []) { result, column in
      let provider = column.item.account.provider.rawValue
      if !result.contains(provider) { result.append(provider) }
    }
  }

  private var loadingContent: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Reading sources…").font(HR.popoverFont(11)).foregroundStyle(HR.secondary).frame(
        height: 16
      ).padding(
        .bottom, 12)
      HStack(alignment: .bottom, spacing: 4) {
        ForEach(0..<9, id: \.self) { _ in Rectangle().fill(HR.muted).frame(height: 64) }
      }.frame(height: 90, alignment: .bottom).padding(.bottom, 12)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(
            ["claude", "codex", "cursor", "copilot", "antigravity", "grok", "vercel_ai_gateway"],
            id: \.self
          ) { provider in
            HStack(spacing: 7) {
              ProviderMark(provider: provider).frame(width: 14, height: 14)
              Text(Presentation.providerName(provider)).font(HR.popoverFont(12, .medium))
            }.frame(height: 24)
            HStack(spacing: 16) {
              Rectangle().fill(HR.muted).frame(width: 84, height: 10)
              Rectangle().fill(HR.muted).frame(height: 5)
              Rectangle().fill(HR.muted).frame(width: 40, height: 10)
            }.frame(height: 50)
            Divider().overlay(HR.border)
          }
        }
      }.frame(height: 482)

    }.padding(.horizontal, 16).accessibilityElement(children: .ignore)
      .accessibilityLabel("Reading sources. Loading account readings")
  }

  @ViewBuilder private var emptyAccounts: some View {
    if let snapshot = model.sources.first(where: { $0.state != .connected }) {
      PopoverState(
        art: snapshot.state == .signedOut ? "signed-out" : "source-offline",
        title: sourceNote(snapshot), message: "Readings appear when this source is available."
      ) {
        Button("Open dashboard") { model.openDashboard(snapshot.source) }.buttonStyle(.plain)
      }
    } else {
      PopoverState(
        art: "no-accounts", title: "No accounts yet",
        message: "Link accounts in your web dashboard."
      ) {
        if let source = model.sources.first?.source {
          Button("Open dashboard") { model.openDashboard(source) }.buttonStyle(.plain)
        }
      }
    }
  }

  private func sourceNote(_ snapshot: SourceSnapshot) -> String {
    if snapshot.state == .offline {
      return
        "\(snapshot.source.name) is offline. Kept readings from \(Formatting.age(snapshot.cached?.readAt, now: model.now))."
    }
    if snapshot.state == .signedOut {
      return "\(snapshot.source.name) is signed out. Open the dashboard to sign in."
    }
    if snapshot.state == .needsUpdate { return "\(snapshot.source.name) needs an update." }
    return "\(snapshot.source.name) is loading."
  }

  private var footer: some View {
    HStack(spacing: 0) {
      if model.sources.isEmpty {
        Text("No readings yet")
      } else if loading {
        Text("Room and reset times appear after the first reading.")
      } else {
        Text(
          "Updated \(Formatting.age(model.sources.compactMap(\.cached?.readAt).max(), now: model.now))"
        )
        ForEach(model.sources) { snapshot in
          Text(" · ")
          Button(snapshot.source.name + (snapshot.state == .offline ? " offline" : "")) {
            model.openDashboard(snapshot.source)
          }.buttonStyle(.plain).help("Open \(snapshot.source.name) dashboard")
        }
      }
    }.font(HR.popoverFont(11)).foregroundStyle(HR.secondary).lineLimit(1).frame(height: 20)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
      .overlay(alignment: .top) { Rectangle().fill(HR.border).frame(height: 1) }
  }
}

struct PopoverToolStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.frame(minWidth: 32, minHeight: 32)
      .background(
        configuration.isPressed ? HR.track : .clear, in: RoundedRectangle(cornerRadius: 6)
      )
      .contentShape(Rectangle())
  }
}

struct PopoverState<Actions: View>: View {
  let art: String
  let title: String
  let message: String
  @ViewBuilder var actions: Actions
  var body: some View {
    VStack(spacing: 0) {
      Image(art).resizable().aspectRatio(contentMode: .fit).frame(width: 160, height: 160)
        .accessibilityHidden(true).padding(.bottom, 12)
      Text(title).font(HR.popoverFont(16, .medium)).accessibilityAddTraits(.isHeader).padding(
        .bottom, 8)
      Text(message).font(HR.popoverFont(12)).foregroundStyle(HR.secondary).lineSpacing(3)
      actions.font(HR.popoverFont(12)).padding(.top, 12)
    }.multilineTextAlignment(.center).frame(maxWidth: .infinity)
      .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 40)
  }
}

// Static Geist faces avoid variable-font weight substitution in AppKit hosting.
extension HR {
  static let popoverWarning = color(light: 0x8A4C00, dark: 0xF1CD7E)
  static let popoverDanger = color(light: 0xCD1526, dark: 0xFF746E)
  static let popoverBaseline = color(light: 0xC4C4C4, dark: 0x484848)
  static let popoverNoData = color(light: 0x8A8A8A, dark: 0x7A7A7A)
  static func popoverFont(_ size: CGFloat = 13, _ weight: Font.Weight = .regular) -> Font {
    let face =
      weight == .semibold
      ? "HeadroomGeist-Semibold"
      : weight == .medium ? "HeadroomGeist-Medium" : "HeadroomGeist-Regular"
    return .custom(face, size: max(11, size))
  }
}
