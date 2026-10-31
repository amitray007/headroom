import AppKit
import HeadroomKit
import SwiftUI

struct PopoverView: View {
  @Bindable var model: AppModel
  @Environment(\.openSettings) private var openSettings
  @State private var showingNotices = false
  @State private var filter: String?

  init(model: AppModel, notices: Bool = false) {
    self.model = model
    _showingNotices = State(initialValue: notices)
  }

  var body: some View {
    VStack(spacing: 0) {
      if showingNotices {
        NoticesView(model: model) { showingNotices = false }
      } else {
        header
        Divider().overlay(HR.border)
        content
      }
      footer
    }
    .font(HR.font()).foregroundStyle(HR.ink).background(HR.surface)
    .frame(width: 420)
    .preferredColorScheme(model.colorScheme)
    .task { await model.setOpen(true) }
    .onDisappear { Task { await model.setOpen(false) } }
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
    VStack(spacing: 12) {
      HStack(spacing: 7) {
        HeadroomGlyph().frame(width: 23, height: 23)
        Text("Headroom").font(HR.font(14, .semibold)).accessibilityAddTraits(.isHeader)
        Spacer()
        Button {
          Task { await model.readSources() }
        } label: {
          Image(systemName: "arrow.clockwise")
        }.buttonStyle(ToolButtonStyle()).help("Read sources")
          .accessibilityLabel("Read sources. Reads the feed without refreshing accounts")
          .disabled(model.sources.isEmpty)
        Button {
          showingNotices = true
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "bell")
            if model.unread > 0 { Text("\(model.unread)") }
          }
        }.buttonStyle(ToolButtonStyle()).help("Notices")
          .accessibilityLabel("Notices, \(model.unread) unread")
        Menu {
          Button("Settings…") {
            NSApp.activate()
            openSettings()
          }.keyboardShortcut(",")
          Divider()
          Button("Quit Headroom") { NSApp.terminate(nil) }.keyboardShortcut("q")
        } label: {
          Image(systemName: "gearshape").frame(width: 24, height: 24)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().accessibilityLabel(
          "App menu")
      }
      if !model.accounts.isEmpty && !allClear {
        HStack(spacing: 6) {
          tile(
            "Out now", value: "\(outCount)", tone: outCount > 0 ? HR.danger : HR.secondary,
            key: "out")
          tile(
            "Runs out", value: "\(runsOutCount)",
            tone: runsOutCount > 0 ? HR.warning : HR.secondary, key: "tight")
          tile(
            "Sign in", value: "\(signInCount)", tone: signInCount > 0 ? HR.danger : HR.secondary,
            key: "signin")
          tile("Banked resets", value: bankedCount, tone: HR.ink, key: "banked")
        }
        VStack(spacing: 4) {
          if let nextBack { summaryRow("Next back", nextBack) }
          summaryRow("Extra spend", extraSpend)
          summaryRow("Plans", monthlyPlans)
        }
      }
      if !model.accounts.isEmpty {
        ForEach(model.sources.filter { $0.state != .connected }) { snapshot in
          Button {
            model.openDashboard(snapshot.source)
          } label: {
            Text(sourceNotice(snapshot)).font(HR.font(11)).lineLimit(1)
              .truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
              .foregroundStyle(snapshot.state == .signedOut ? HR.danger : HR.secondary)
          }.buttonStyle(.plain).help(sourceNotice(snapshot) + " Open dashboard")
        }
      }
    }.padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
  }

  @ViewBuilder private var content: some View {
    if model.accounts.isEmpty
      && (!model.ready
        || model.sources.contains(where: { $0.state == .noData && $0.cached == nil }))
    {
      VStack(spacing: 0) {
        ArtState(
          art: "loading", title: "Loading your first readings",
          message: "Sources are starting. Readings appear as they arrive.")
        if model.accounts.isEmpty { skeletons } else { accountList }
      }
    } else if model.sources.isEmpty {
      VStack(spacing: 0) {
        ArtState(
          art: "no-sources", title: "No sources yet",
          message: "Add your Headroom server or this Mac.")
        Button("Add a source") {
          model.selectedPane = .sources
          NSApp.activate()
          openSettings()
        }
        .buttonStyle(HRButtonStyle()).padding(.bottom, 24)
      }
    } else {
      accountList
    }
  }

  private var accountList: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(
          model.sources.filter {
            model.accounts.isEmpty && $0.state != .connected && $0.state != .noData
          }
        ) {
          snapshot in
          sourceState(snapshot)
        }
        ForEach(
          model.sources.filter {
            model.accounts.isEmpty && $0.state == .connected
              && $0.cached?.feed.accounts.isEmpty == true
          }
        ) { snapshot in
          ArtState(
            art: "no-accounts", title: "No accounts on \(snapshot.source.name)",
            message: "Link accounts in its web dashboard.")
          Button("Open in web dashboard") { model.openDashboard(snapshot.source) }
            .buttonStyle(HRButtonStyle()).frame(maxWidth: .infinity).padding(.bottom, 16)
        }
        if allClear && filter == nil && !model.accounts.isEmpty {
          ArtState(
            art: "all-clear", title: "All clear", message: "No limits need attention.",
            compact: true)
        }
        if let filter {
          HStack {
            Text(filterLabel(filter)).font(HR.font(11)).foregroundStyle(HR.secondary)
            Spacer()
            Button("Show all") { self.filter = nil }.buttonStyle(.plain).font(HR.font(11))
          }.padding(.bottom, 12)
        }
        ForEach(providers, id: \.self) { provider in
          let items = visibleItems.filter { $0.account.provider.rawValue == provider }
          if !items.isEmpty {
            if provider != providers.first { Divider().overlay(HR.border).padding(.vertical, 12) }
            ProviderSection(provider: provider, items: items, model: model)
          }
        }
        if visibleItems.isEmpty && !model.accounts.isEmpty {
          Text("No matching accounts.").font(HR.font(12)).foregroundStyle(HR.secondary).padding(
            .vertical, 20)
        } else if model.accounts.isEmpty && !model.allAccounts.isEmpty {
          Text("All accounts are hidden in List settings.").font(HR.font(12)).foregroundStyle(
            HR.secondary
          ).padding(.vertical, 20)
        }
      }.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 16)
    }
    .frame(height: listHeight)
  }

  private var listHeight: CGFloat {
    if model.captureState == "no-accounts" { return 270 }
    if model.accounts.isEmpty {
      return model.sources.contains(where: { $0.state != .connected }) ? 280 : 270
    }
    return 420
  }

  private func sourceState(_ snapshot: SourceSnapshot) -> some View {
    VStack(spacing: 0) {
      ArtState(
        art: snapshot.state == .signedOut ? "signed-out" : "source-offline",
        title: snapshot.state == .signedOut
          ? "Signed out of \(snapshot.source.name)"
          : snapshot.state == .needsUpdate
            ? "\(snapshot.source.name) needs an update" : "\(snapshot.source.name) is offline",
        message: snapshot.state == .signedOut
          ? "Token revoked. Other sources keep their readings."
          : snapshot.state == .needsUpdate
            ? "Update this server to use the Mac app."
            : "Kept readings · last sync \(Formatting.age(snapshot.cached?.readAt, now: model.now))."
      )
      if snapshot.state == .signedOut || snapshot.state == .needsUpdate {
        Button("Open in web dashboard") {
          model.openDashboard(snapshot.source)
        }
        .buttonStyle(HRButtonStyle()).padding(.bottom, 16)
      }
    }.frame(maxWidth: .infinity)
  }

  private func sourceNotice(_ snapshot: SourceSnapshot) -> String {
    let status =
      snapshot.state == .signedOut
      ? "is signed out"
      : snapshot.state == .noData
        ? "is loading" : snapshot.state == .needsUpdate ? "needs an update" : "is offline"
    let cache =
      snapshot.cached.map { " · kept readings from " + Formatting.age($0.readAt, now: model.now) }
      ?? ""
    return snapshot.source.name + " " + status + cache
  }

  private var skeletons: some View {
    VStack(spacing: 16) {
      ForEach(0..<2, id: \.self) { _ in
        VStack(alignment: .leading, spacing: 12) {
          RoundedRectangle(cornerRadius: 4).fill(HR.muted).frame(width: 180, height: 14)
          ForEach(0..<3, id: \.self) { _ in
            RoundedRectangle(cornerRadius: 4).fill(HR.muted).frame(height: 10)
          }
        }.padding(.vertical, 8)
      }
    }.padding(16).accessibilityLabel("Loading account readings")
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if model.sources.isEmpty {
        Text("No sources configured")
      } else if model.sources.allSatisfy({ $0.cached == nil && $0.state == .noData }) {
        Circle().fill(HR.secondary).frame(width: 6, height: 6)
        Text("Sources starting…")
      } else {
        Text("Updated \(Formatting.age(latestReading, now: model.now))").fixedSize()
        ScrollView(.horizontal) {
          HStack(spacing: 2) {
            ForEach(model.sources) { snapshot in
              Button {
                model.openDashboard(snapshot.source)
              } label: {
                HStack(spacing: 4) {
                  Circle().fill(
                    snapshot.state == .signedOut
                      ? HR.danger : HR.secondary
                  ).frame(width: 5, height: 5)
                  Text(snapshot.source.name)
                  if snapshot.state != .connected {
                    Text(snapshot.state.label).foregroundStyle(
                      snapshot.state == .signedOut ? HR.danger : HR.secondary)
                  }
                }.fixedSize().padding(.horizontal, 6).padding(.vertical, 3)
              }.buttonStyle(ToolButtonStyle()).help("Open \(snapshot.source.name) dashboard")
                .accessibilityLabel(
                  "\(snapshot.source.name), \(snapshot.state.label). Open web dashboard")
            }
          }
        }.scrollIndicators(.hidden)
      }
    }.font(HR.font(11)).foregroundStyle(HR.secondary).frame(
      maxWidth: .infinity, alignment: .leading
    )
    .padding(.horizontal, 16).padding(.vertical, 10)
    .overlay(alignment: .top) { Rectangle().fill(HR.border).frame(height: 1) }
  }

  private var latestReading: Date? {
    model.accounts.compactMap { Formatting.date(milliseconds: $0.account.observedAt) }.max()
  }
  private var providers: [String] {
    var result: [String] = []
    for snapshot in model.sources {
      for id in snapshot.cached?.feed.providerOrder.map(\.rawValue) ?? [] where !result.contains(id)
      { result.append(id) }
    }
    for item in model.accounts where !result.contains(item.account.provider.rawValue) {
      result.append(item.account.provider.rawValue)
    }
    return result
  }
  private var visibleItems: [AccountItem] {
    model.accounts.filter { item in
      switch filter {
      case "out": item.binding?.percentLeft == 0
      case "tight": item.account.limits.contains { $0.runsOutAt != nil && $0.percentLeft != 0 }
      case "signin": item.account.state == .reconnect_required || item.snapshot.state == .signedOut
      case "banked": (item.account.banked?.count ?? 0) > 0
      default: true
      }
    }
  }
  private var outCount: Int { model.accounts.filter { $0.binding?.percentLeft == 0 }.count }
  private var runsOutCount: Int {
    model.accounts.filter { $0.binding?.runsOutAt != nil && $0.binding?.percentLeft != 0 }.count
  }
  private var signInCount: Int {
    model.accounts.filter {
      $0.account.state == .reconnect_required || $0.snapshot.state == .signedOut
    }.count
  }
  private var bankedCount: String {
    let values = model.accounts.compactMap(\.account.banked)
    if values.contains(where: { $0.count == nil }) { return "Unknown" }
    return String(format: "%.0f", values.compactMap(\.count).reduce(0, +))
  }
  private var allClear: Bool {
    outCount == 0 && runsOutCount == 0 && signInCount == 0
      && model.sources.allSatisfy { $0.state == .connected }
      && model.accounts.allSatisfy { item in
        item.account.limits.allSatisfy { $0.unlimited || ($0.percentLeft.map { $0 > 20 } ?? false) }
      }
  }
  private var nextBack: String? {
    guard
      let item = model.accounts.filter({
        $0.binding?.percentLeft == 0 && $0.binding?.resetsAt != nil
      })
      .min(by: { ($0.binding?.resetsAt ?? 0) < ($1.binding?.resetsAt ?? 0) })
    else { return nil }
    return
      "\(item.name) · \(Formatting.when(Formatting.date(milliseconds: item.binding?.resetsAt), now: model.now))"
  }
  private var extraSpend: String {
    let amounts = model.sources.compactMap(\.cached?.feed.summary.extraSpend).flatMap { $0 }
    let units = Set(amounts.map(\.unit)).sorted()
    if units.isEmpty { return "Unknown" }
    return units.map { unit in
      let rows = amounts.filter { $0.unit == unit }
      return Formatting.unitTotal(rows.map(\.value), unit: unit)
    }.joined(separator: " · ")
  }
  private var monthlyPlans: String {
    let feeds = model.sources.compactMap(\.cached?.feed)
    guard feeds.count == model.sources.count,
      feeds.allSatisfy({ $0.summary.monthlyPlanTotal != nil })
    else { return "Unknown" }
    let totals = feeds.compactMap(\.summary.monthlyPlanTotal)
    let currencies = Set(totals.map { $0.currency.rawValue }).sorted()
    var labels: [String] = []
    for currency in currencies {
      let minor = totals.filter { $0.currency.rawValue == currency }.reduce(0) { $0 + $1.minor }
      let value = Double(minor) / (currency == "JPY" ? 1 : 100)
      labels.append(Formatting.money(value, unit: currency) + " a month")
    }
    return labels.joined(separator: " · ")
  }
  private func tile(_ title: String, value: String, tone: Color, key: String) -> some View {
    Button {
      filter = filter == key ? nil : key
    } label: {
      VStack(alignment: .leading, spacing: 4) {
        Text(value).font(HR.font(18, .semibold)).foregroundStyle(tone)
        Text(title).font(HR.font(11)).foregroundStyle(HR.secondary).fixedSize()
      }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).padding(
        .vertical, 9
      )
      .background(HR.muted, in: RoundedRectangle(cornerRadius: 10))
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(filter == key ? HR.ink : HR.border))
    }.buttonStyle(.plain).accessibilityLabel("\(value) \(title). Filter accounts")
      .accessibilityAddTraits(filter == key ? .isSelected : [])
  }
  private func summaryRow(_ title: String, _ value: String) -> some View {
    HStack(spacing: 12) {
      Text(title).foregroundStyle(HR.secondary)
      Spacer(minLength: 0)
      Text(value).fontWeight(.medium).lineLimit(1).help(value)
    }.font(HR.font(13)).monospacedDigit().accessibilityElement(children: .combine)
  }
  private func filterLabel(_ filter: String) -> String {
    switch filter {
    case "out": "Out now"
    case "tight": "Runs out"
    case "signin": "Sign in"
    default: "Banked resets"
    }
  }
}
