import AppKit
import HeadroomKit
import SwiftUI

/// The popover root. It holds only which page is shown and the page height; each part below
/// is its own view and reads only the model values it shows, so a change to one (the refresh
/// flag, a row opening, the unread count) redraws that part and not every account row.
struct PopoverView: View {
  let model: AppModel
  @State private var showingNotices = false
  /// The account page's height. Notices take the same height so switching pages never
  /// resizes the popover.
  @State private var pageHeight: CGFloat = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init(model: AppModel, notices: Bool = false) {
    self.model = model
    _showingNotices = State(initialValue: notices)
  }

  var body: some View {
    VStack(spacing: 0) {
      // Both pages share one layer during the switch; a VStack would stack them and grow the
      // popover to their sum for the length of the animation.
      ZStack(alignment: .top) {
        if showingNotices {
          NoticesView(model: model, fill: pageHeight > 0) { showNotices(false) }
            .transition(Motion.page(.trailing, reduceMotion))
        } else {
          VStack(spacing: 0) {
            PopoverHeader(model: model) { showNotices(true) }
            AccountsPage(model: model)
          }
          .onGeometryChange(for: CGFloat.self) {
            $0.size.height
          } action: {
            pageHeight = $0
          }
          .transition(Motion.page(.leading, reduceMotion))
        }
      }.frame(
        height: pageHeight > 0 ? max(pageHeight, showingNotices ? 400 : 0) : nil, alignment: .top)
      PopoverFooter(model: model)
    }
    .font(HR.popoverFont()).monospacedDigit().foregroundStyle(HR.ink).background(HR.surface)
    .frame(width: 600)
    .clipped()
    .task { if model.bannerNoticeID != nil { showingNotices = true } }
    .onChange(of: model.bannerNoticeID) { _, id in
      if id != nil { showNotices(true) }
    }
    .alert(
      "Headroom",
      isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
    ) {
      Button("OK") { model.error = nil }
    } message: {
      Text(model.error ?? "")
    }
  }

  private func showNotices(_ value: Bool) {
    guard showingNotices != value else { return }
    withAnimation(Motion.view(reduceMotion)) { showingNotices = value }
  }
}

extension AppModel {
  /// No account readings yet because a shown source has not answered. The source check is
  /// cheap and usually false, so the account list is rarely built here.
  var popoverLoading: Bool {
    displaySources.isEmpty
      ? !ready
      : popoverSources.contains { $0.state == .noData } && popoverAccounts.isEmpty
  }

  func openSettingsWindow(_ open: OpenSettingsAction) {
    NSApp.activate()
    open()
  }
}

/// The title and the refresh, notices and settings buttons.
private struct PopoverHeader: View {
  let model: AppModel
  let openNotices: () -> Void
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    let loading = model.popoverLoading
    HStack(spacing: 8) {
      HeadroomGlyph().frame(width: 23, height: 23)
      Text("Headroom").font(HR.popoverFont(16, .medium)).accessibilityAddTraits(.isHeader)
      Spacer()
      // The tool buttons carry their own 8 pt hover inset, so they sit 2 pt apart: about
      // 18 pt between glyphs.
      HStack(spacing: 2) {
        if !loading && !model.displaySources.isEmpty {
          Button {
            Task { await model.readSources() }
          } label: {
            ZStack {
              if model.refreshing {
                AtomSpinner(size: 16)
              } else {
                Image(systemName: "arrow.clockwise").font(.system(size: 16))
              }
            }.frame(width: 18, height: 18)
          }.buttonStyle(PopoverToolStyle()).help("Read sources").disabled(model.refreshing)
            .accessibilityLabel(model.refreshing ? "Reading sources" : "Read sources")
          Button {
            openNotices()
          } label: {
            HStack(spacing: 5) {
              Image(systemName: "bell").font(.system(size: 16))
              if model.noticePhase == .ready && !model.popoverNotices.isEmpty {
                Text("\(popoverUnread)").font(HR.popoverFont(12))
              }
            }
          }.buttonStyle(PopoverToolStyle()).accessibilityLabel(
            "Notifications, \(popoverUnread) unread")
        }
        Button {
          model.openSettingsWindow(openSettings)
        } label: {
          Image(systemName: "gearshape").font(.system(size: 16))
        }
        .buttonStyle(PopoverToolStyle()).help("Open Settings").accessibilityLabel(
          "Open Settings"
        )
        .contextMenu { Button("Quit Headroom") { NSApp.terminate(nil) } }
      }
    }.padding(.leading, 16).padding(.trailing, 8).frame(height: 52)
  }

  private var popoverUnread: Int { model.popoverNotices.filter { !$0.read }.count }
}

/// The summary line and the account list, or the loading and empty states.
private struct AccountsPage: View {
  let model: AppModel
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    // Build the rows once per render; the summary and every provider group share them.
    let rows = RoomNow(items: model.popoverAccounts, now: model.now).columns.map {
      LedgerRow(column: $0, now: model.now)
    }
    VStack(spacing: 0) {
      if model.popoverLoading {
        loadingContent
      } else if model.displaySources.isEmpty {
        PopoverState(
          art: "no-sources", title: "No sources yet",
          message: "Add a Headroom server to see its accounts here."
        ) {
          Button("Add a source") {
            model.selectedPane = .sources
            model.openSettingsWindow(openSettings)
          }.buttonStyle(PopoverActionStyle())
        }
      } else if rows.isEmpty {
        emptyAccounts
      } else {
        summaryLine(rows)
        ForEach(model.popoverSources.filter { $0.state != .connected }) { snapshot in
          Text(sourceNote(snapshot)).font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
            .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 10).padding(.horizontal, 16)
          Divider().overlay(HR.border)
        }
        // Each row used to rebuild every account to decide this, on every hover.
        let all = model.accounts
        AccountList(
          groups: groups(rows),
          withSource: Set(rows.filter { Presentation.needsSource($0.item, among: all) }.map(\.id)),
          model: model)
      }
    }
  }

  private func summaryLine(_ rows: [LedgerRow]) -> some View {
    let summary = LedgerSummary(rows: rows, feeds: model.popoverSources.compactMap(\.cached?.feed))
    return HStack(spacing: 14) {
      if let plans = summary.plans { Text("**\(plans)** a month in plans") }
      if let spend = summary.extraSpend { Text("**\(spend)** extra spend") }
      if summary.banked > 0 {
        Text("**\(summary.banked)** banked \(summary.banked == 1 ? "reset" : "resets")")
      }
      Spacer(minLength: 8)
      if summary.out > 0 {
        Text("\(Text("\(summary.out)").foregroundStyle(HR.popoverDanger)) out")
      }
      if summary.low > 0 {
        Text("\(Text("\(summary.low)").foregroundStyle(HR.popoverWarning)) running low")
      }
    }.font(HR.popoverFont(12)).foregroundStyle(HR.secondary).lineLimit(1)
      .padding(.horizontal, 16).padding(.bottom, 12)
      .overlay(alignment: .bottom) { Rectangle().fill(HR.border).frame(height: 1) }
  }

  /// Rows by provider, in the order providers first appear, in one pass.
  private func groups(_ rows: [LedgerRow]) -> [(provider: String, rows: [LedgerRow])] {
    var order: [String] = []
    var byProvider: [String: [LedgerRow]] = [:]
    for row in rows {
      let provider = row.item.account.provider.rawValue
      if byProvider[provider] == nil { order.append(provider) }
      byProvider[provider, default: []].append(row)
    }
    return order.map { ($0, byProvider[$0] ?? []) }
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
    if let snapshot = model.popoverSources.first(where: { $0.state != .connected }) {
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
        if let source = model.popoverSources.first?.source {
          Button("Open dashboard") { model.openDashboard(source) }.buttonStyle(.plain)
        }
      }
    }
  }

  private func sourceNote(_ snapshot: SourceSnapshot) -> String {
    if snapshot.state == .offline {
      return
        "\(snapshot.source.name) is offline. Kept readings from \(Formatting.age(model.readAt(snapshot), now: model.now))."
    }
    if snapshot.state == .signedOut {
      return "\(snapshot.source.name) is signed out. Open the dashboard to sign in."
    }
    if snapshot.state == .needsUpdate { return "\(snapshot.source.name) needs an update." }
    return "\(snapshot.source.name) is loading."
  }
}

/// The scrolling rows. Its height lives here, so opening a row redraws this list and not the
/// page around it.
private struct AccountList: View {
  let groups: [(provider: String, rows: [LedgerRow])]
  let withSource: Set<String>
  let model: AppModel
  @State private var listHeight: CGFloat = 0

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(spacing: 0) {
          ForEach(groups, id: \.provider) { group in
            LedgerGroup(rows: group.rows, withSource: withSource, model: model)
              .id(group.provider)
            if group.provider != groups.last?.provider { Divider().overlay(HR.border) }
          }
        }
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          listHeight = $0
        }
        // A little room after the last row: at the end the fade's clear top half lies over the
        // row's empty lower edge, so the fade can stay put and nothing changes while scrolling.
        .padding(.bottom, listHeight > listCap ? 12 : 0)
      }.frame(height: min(max(listHeight, 44), listCap))
        // A fade over the cut row says the list goes on; at the end it covers only the room
        // left after the last row.
        .overlay(alignment: .bottom) {
          LinearGradient(
            colors: [HR.surface.opacity(0), HR.surface], startPoint: .top, endPoint: .bottom
          )
          .frame(height: 24).allowsHitTesting(false)
          .opacity(listHeight > listCap ? 1 : 0)
        }
        .onAppear {
          if model.synthetic && model.captureState == "lower" {
            proxy.scrollTo(groups.last?.provider, anchor: .bottom)
          }
        }
    }
  }

  /// About nine rows, then the list scrolls. A short screen lowers it so the popover keeps clear
  /// of the menu bar and the Dock: header, summary, footer and margins take about 180 pt. A
  /// list taller than that stops through the middle of a row, so the cut row says there is more.
  private var listCap: CGFloat {
    let screen = NSScreen.main?.visibleFrame.height ?? 900
    let limit = max(176, min(440, screen - 180))
    // Collapsed rows are 44 pt; each provider group adds 4 pt above and below and a 1 pt rule.
    var y: CGFloat = 0
    var cut: CGFloat?
    for (index, group) in groups.enumerated() {
      y += 4
      for _ in group.rows {
        if y + 22 <= limit { cut = y + 22 }
        y += 44
      }
      y += index < groups.count - 1 ? 5 : 4
    }
    return y <= limit ? limit : cut ?? limit
  }
}

/// Last read, Open dashboard and the source selector.
private struct PopoverFooter: View {
  let model: AppModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 6) {
      if model.displaySources.isEmpty {
        Text("No readings yet")
      } else if model.popoverLoading {
        Text("Room and reset times appear after the first reading.")
      } else {
        Text(
          "Updated \(Formatting.age(model.refreshedAt ?? model.popoverSources.compactMap(model.readAt).max(), now: model.now))"
        )
      }
      Spacer(minLength: 12)
      if !model.displaySources.isEmpty {
        dashboardButton
        sourcePicker
      }
    }.font(HR.popoverFont(11)).foregroundStyle(HR.secondary).lineLimit(1).frame(height: 22)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
      .overlay(alignment: .top) { Rectangle().fill(HR.border).frame(height: 1) }
  }

  /// The one way to the web dashboard: the shown source's, or a choice when several are shown.
  @ViewBuilder private var dashboardButton: some View {
    // The macOS "opens elsewhere" glyph, quieter than the label it follows.
    let label = HStack(spacing: 5) {
      Text("Open dashboard").foregroundStyle(HR.ink)
      Image(systemName: "arrow.up.right.square").font(.system(size: 11, weight: .regular))
        .foregroundStyle(HR.secondary)
    }
    if model.popoverSources.count == 1, let source = model.popoverSources.first?.source {
      Button {
        model.openDashboard(source)
      } label: {
        label
      }.buttonStyle(PopoverFooterStyle()).help("Open the \(source.name) dashboard")
    } else {
      Menu {
        ForEach(model.popoverSources) { snapshot in
          Button(snapshot.source.name) { model.openDashboard(snapshot.source) }
        }
      } label: {
        label
      }.menuStyle(.button).buttonStyle(PopoverFooterStyle()).menuIndicator(.hidden).fixedSize()
        .help("Choose a dashboard to open")
    }
  }

  /// Which sources the popover shows: all of them, or one.
  private var sourcePicker: some View {
    let selected = model.popoverSources.count == 1 && model.displaySources.count > 1
    return Menu {
      Picker("Show", selection: sourceFilter) {
        Text("All sources").tag(UUID?.none)
        ForEach(model.displaySources) { snapshot in
          Text(snapshot.source.name).tag(UUID?.some(snapshot.id))
        }
      }.pickerStyle(.inline)
    } label: {
      HStack(spacing: 4) {
        Text(selected ? model.popoverSources[0].source.name : "All sources")
        Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold))
      }.foregroundStyle(HR.ink)
    }.menuStyle(.button).buttonStyle(PopoverFooterStyle()).menuIndicator(.hidden).fixedSize()
      .help("Choose which sources to show").accessibilityLabel("Sources shown")
  }

  private var sourceFilter: Binding<UUID?> {
    Binding(
      get: { model.popoverSources.count == 1 ? model.preferences.sourceFilter : nil },
      set: { value in
        withAnimation(Motion.view(reduceMotion)) { model.preferences.sourceFilter = value }
        model.saveDisplay()
      })
  }
}

struct PopoverFooterStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    HoverSurface(pressed: configuration.isPressed, bordered: true) {
      configuration.label.font(HR.popoverFont(11, .medium)).padding(.horizontal, 8)
        .frame(height: 22)
    }
  }
}

struct PopoverToolStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    HoverSurface(pressed: configuration.isPressed, bordered: false) {
      // Even side padding, so a label wider than its icon (the bell and its count) keeps
      // the same inset as the icon-only buttons.
      configuration.label.padding(.horizontal, 8).frame(minWidth: 32, minHeight: 32)
    }
  }
}

/// A quiet hover fill and a small press, shared by the popover's icon and footer buttons.
private struct HoverSurface<Label: View>: View {
  let pressed: Bool
  let bordered: Bool
  @ViewBuilder var label: Label
  @Environment(\.isEnabled) private var enabled
  @State private var hovered = false
  var body: some View {
    label
      .background(
        pressed ? HR.track : hovered && enabled ? HR.muted : .clear,
        in: RoundedRectangle(cornerRadius: 6)
      )
      .overlay {
        if bordered { RoundedRectangle(cornerRadius: 6).strokeBorder(HR.border) }
      }
      .scaleEffect(pressed && enabled ? 0.97 : 1)
      .animation(Motion.press(pressed), value: pressed)
      .animation(Motion.hover, value: hovered)
      .onHover { hovered = $0 }
      .contentShape(Rectangle())
  }
}

/// The one action of an empty state: a quiet filled button, never the accent color.
struct PopoverActionStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(HR.popoverFont(12, .medium)).padding(.horizontal, 14).frame(height: 30)
      .background(
        configuration.isPressed ? HR.track : HR.muted, in: RoundedRectangle(cornerRadius: 7)
      )
      .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(HR.border))
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
      .padding(.horizontal, 24).padding(.vertical, 32)
  }
}

// Static Geist faces avoid variable-font weight substitution in AppKit hosting.
extension HR {
  static let popoverWarning = color(light: 0x8A4C00, dark: 0xF1CD7E)
  static let popoverDanger = color(light: 0xCD1526, dark: 0xFF746E)
  static let popoverSuccess = color(light: 0x1A7F37, dark: 0x6BD68F)
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
