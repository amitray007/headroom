import AppKit
import HeadroomKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @State private var editing: SourceDraft?
  @State private var remove: SourceSnapshot?
  @State private var dropTarget: String?
  @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
  /// The source whose More menu is open.
  @State private var sourceMenu: UUID?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 0) {
      VStack(spacing: 2) {
        ForEach(SettingsPane.allCases) { pane in
          SidebarItem(title: pane.rawValue, selected: model.selectedPane == pane) {
            withAnimation(.easeOut(duration: 0.14)) { model.selectedPane = pane }
          }
        }
        Spacer()
      }
      // The window content runs under the title bar; the list starts below the traffic lights.
      .padding(.horizontal, 10).padding(.top, 48).frame(width: 165)
      .background(HR.background)
      .overlay(alignment: .trailing) { Rectangle().fill(HR.borderSubtle).frame(width: 1) }
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text(model.selectedPane.rawValue).font(HR.popoverFont(16, .medium))
            .frame(height: 34).padding(.horizontal, 24).accessibilityAddTraits(.isHeader)
          switch model.selectedPane {
          case .menuBar: menuBar
          case .accounts: accountList
          case .notifications: notifications
          case .sources: sources
          case .general: general
          }
        }
        // The pane title sits in the traffic lights' row, 24 pt from the top.
        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 7).padding(.bottom, 24)
      }
      .scrollIndicators(.never).hidingTopScrollEdge().id(model.selectedPane)
      .transition(Motion.reveal(reduceMotion))
      .background(HR.raisedSurface)
    }
    .font(HR.popoverFont(14)).foregroundStyle(HR.ink).tint(HR.ink)
    .overlayPreferenceValue(SourceMenuAnchors.self) { anchors in sourceMenuLayer(anchors) }
    .onKeyPress(.escape) {
      guard sourceMenu != nil else { return .ignored }
      closeSourceMenu()
      return .handled
    }
    .onChange(of: model.selectedPane) { _, _ in sourceMenu = nil }
    // The window is 598 pt of content plus the title bar. The panes fill both: they stretch up
    // under the transparent title bar, while the outer frame still sizes the window.
    .frame(width: 700).frame(maxHeight: .infinity)
    .ignoresSafeArea(.container, edges: .top)
    .frame(height: 598)
    // The title sat across the sidebar edge; each pane already names itself.
    .toolbar(removing: .title)
    .background(SettingsWindowChrome())
    .onChange(of: model.preferences) { _, _ in model.saveDisplay() }
    .sheet(item: $editing) { draft in SourceEditor(model: model, draft: draft) { editing = nil } }
    .confirmationDialog(
      "Remove \(remove?.source.name ?? "source") from this Mac?",
      isPresented: Binding(get: { remove != nil }, set: { if !$0 { remove = nil } })
    ) {
      Button("Remove source", role: .destructive) {
        if let remove { Task { await model.removeSource(remove) } }
        remove = nil
      }
      Button("Cancel", role: .cancel) { remove = nil }
    } message: {
      Text(
        "Its saved token, readings and notification history will be removed from this Mac. The server and its accounts stay linked."
      )
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

  private func addSource() {
    model.selectedPane = .sources
    editing = SourceDraft()
  }

  // MARK: Menu Bar

  private var menuBar: some View {
    let style = model.preferences.itemStyle
    return SettingsSections {
      SettingsSection("Preview") {
        MenuBarPreview(status: MenuStatus(model: model, style: style, sample: true))
          .padding(.vertical, 8)
      }
      SettingsSection("Show") {
        WebSegmented(
          selection: $model.preferences.itemStyle,
          options: DisplayPreferences.ItemStyle.allCases.map { ($0, $0.label) }
        ).padding(.vertical, 8)
      }
      if style != .logo {
        SettingsSection(style.showsSlots ? "Accounts · up to 3" : "Account") {
          ForEach(Array(model.preferences.slots.enumerated()), id: \.offset) { index, slot in
            if style.showsSlots || index == 0 { slotRow(index, slot: slot, style: style) }
          }
          if style.showsSlots {
            Button(action: addSlot) {
              Label("Add account", systemImage: "plus").font(HR.popoverFont(13, .medium))
                .foregroundStyle(HR.secondary).padding(.horizontal, 14).frame(height: 30)
                .overlay(Capsule().strokeBorder(HR.border, style: StrokeStyle(dash: [3, 3])))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain).padding(.vertical, 10)
            .disabled(model.preferences.slots.count >= DisplayPreferences.maxSlots)
            .opacity(model.preferences.slots.count >= DisplayPreferences.maxSlots ? 0.45 : 1)
          }
        }
      }
      SettingsSection("Options") {
        if style == .liveLogo {
          SettingsRow(
            title: "Room beside the logo",
            note: "Adds the figure of the account with least room, about 32 pt."
          ) {
            Toggle("Room beside the logo", isOn: $model.preferences.liveRoom)
              .toggleStyle(WebSwitchStyle())
          }
        }
        if style == .accounts {
          SettingsRow(title: "Provider logos", note: "Off saves about 16 pt per account.") {
            Toggle("Provider logos", isOn: $model.preferences.providerLogos)
              .toggleStyle(WebSwitchStyle())
          }
        }
        HStack(spacing: 40) {
          VStack(alignment: .leading, spacing: 6) {
            Text("Color when low or out").font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink)
            MenuToneLegend(colors: model.preferences.colorLowOut)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          Toggle("Color when low or out", isOn: $model.preferences.colorLowOut)
            .toggleStyle(WebSwitchStyle())
        }
        .padding(.vertical, 10)
      }
    }
  }

  /// One menu bar slot: the account, its look in the Accounts style, and a grip to drag it into
  /// place. Live logo and Dots stack the slots top to bottom in this order.
  private func slotRow(
    _ index: Int, slot: DisplayPreferences.MenuSlot, style: DisplayPreferences.ItemStyle
  )
    -> some View
  {
    let movable = style.showsSlots && model.preferences.slots.count > 1
    let key = "menu-slot:\(index)"
    // Built once per row: each read of `allAccounts` rebuilds and sorts the whole list.
    let accounts = model.allAccounts
    let chosen = slot.account.flatMap { id in accounts.first { $0.id == id } }
    let name =
      slot.account == nil
      ? "Tightest account with room" : chosen?.name ?? "Account no longer linked"
    return HStack(spacing: 10) {
      if movable {
        Image(systemName: "line.3.horizontal").font(.system(size: 12, weight: .medium))
          .foregroundStyle(HR.textMuted).frame(width: 16).accessibilityHidden(true)
      }
      WebSelect(
        value: name,
        mark: chosen?.account.provider.rawValue,
        symbol: "gauge.medium", fill: true
      ) {
        Button("Tightest account with room") { model.preferences.slots[index].account = nil }
        if !accounts.isEmpty { Divider() }
        ForEach(accounts) { item in
          Button(
            Presentation.needsSource(item, among: accounts)
              ? "\(item.name) · \(item.snapshot.source.name)" : item.name
          ) { model.preferences.slots[index].account = item.id }
        }
      }
      if style == .accounts {
        WebSegmented(
          selection: $model.preferences.slots[index].look,
          options: [(.percent, "%"), (.ring, "Ring"), (.bars, "Bars")], compact: true
        ).help("Bars show the session window over the longer one.")
      }
      if movable {
        Button {
          withAnimation(Motion.expand(reduceMotion)) {
            _ = model.preferences.slots.remove(at: index)
          }
        } label: {
          Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
            .foregroundStyle(HR.textMuted).frame(width: 24, height: 24).contentShape(Rectangle())
        }
        .buttonStyle(.plain).help("Remove").accessibilityLabel("Remove \(name)")
      }
    }
    .padding(.vertical, 8).padding(.horizontal, 8).contentShape(Rectangle())
    .background(dropTarget == key ? HR.muted : .clear, in: RoundedRectangle(cornerRadius: 8))
    .padding(.horizontal, -8).animation(Motion.hover, value: dropTarget)
    .draggable(key) {
      Text(name).font(HR.popoverFont(13, .medium)).padding(.horizontal, 10)
        .padding(.vertical, 6).background(HR.raisedSurface, in: RoundedRectangle(cornerRadius: 7))
    }
    .dropDestination(for: String.self) { keys, _ in
      guard movable, let from = keys.first.flatMap(slotIndex), from != index else { return false }
      withAnimation(Motion.expand(reduceMotion)) {
        model.preferences.slots.move(
          fromOffsets: IndexSet(integer: from), toOffset: index > from ? index + 1 : index)
      }
      return true
    } isTargeted: { targeted in
      if targeted && movable {
        dropTarget = key
      } else if dropTarget == key {
        dropTarget = nil
      }
    }
    .accessibilityAction(named: "Move up") { moveSlot(index, by: -1) }
    .accessibilityAction(named: "Move down") { moveSlot(index, by: 1) }
  }

  private func slotIndex(_ key: String) -> Int? {
    guard key.hasPrefix("menu-slot:") else { return nil }
    return Int(key.dropFirst("menu-slot:".count))
  }

  private func moveSlot(_ index: Int, by offset: Int) {
    guard model.preferences.slots.indices.contains(index + offset) else { return }
    model.preferences.slots.swapAt(index, index + offset)
  }

  /// A new slot takes the tightest account when no slot does yet, else the next account no slot
  /// shows.
  private func addSlot() {
    let slots = model.preferences.slots
    let used = Set(slots.compactMap(\.account))
    let account =
      slots.contains { $0.account == nil }
      ? model.allAccounts.first { !used.contains($0.id) }?.id : nil
    withAnimation(Motion.expand(reduceMotion)) {
      model.preferences.slots.append(.init(account: account, look: slots.last?.look ?? .percent))
    }
  }

  // MARK: List

  @ViewBuilder private var accountList: some View {
    if model.allAccounts.isEmpty {
      if model.sources.isEmpty {
        SettingsEmpty(
          symbol: "list.bullet", title: "No accounts yet",
          message: "Add a source, and its accounts appear here to show, hide and order."
        ) {
          Button("Add a source", action: addSource).buttonStyle(WebButtonStyle(kind: .primary))
        }
      } else {
        SettingsEmpty(
          symbol: "list.bullet", title: "No accounts yet",
          message: "Accounts appear after a source sends its first readings."
        ) {
          if let source = model.sources.first?.source {
            Button("Open dashboard") { model.openDashboard(source) }.buttonStyle(WebButtonStyle())
          }
        }
      }
    } else {
      SettingsSections {
        SettingsSection("Accounts") {
          ForEach(model.allAccounts, id: \.id) { item in
            accountRow(item)
          }
        }
      }
    }
  }

  /// A row to drag into place: the grip says it moves, and the row it is over fills to show
  /// whose place it takes. VoiceOver gets Move up and Move down actions instead.
  private func accountRow(_ item: AccountItem) -> some View {
    HStack(spacing: 10) {
      Image(systemName: "line.3.horizontal").font(.system(size: 12, weight: .medium))
        .foregroundStyle(HR.textMuted).frame(width: 16).accessibilityHidden(true)
      HStack(spacing: 40) {
        AccountListLabel(item: item, privacy: model.preferences.privacy)
          .frame(maxWidth: .infinity, alignment: .leading)
        Toggle("Show \(item.name)", isOn: shown(item)).toggleStyle(WebSwitchStyle())
      }
      .padding(.vertical, 10)
    }
    .padding(.horizontal, 8).contentShape(Rectangle())
    .background(
      dropTarget == item.id ? HR.muted : .clear, in: RoundedRectangle(cornerRadius: 8)
    )
    .padding(.horizontal, -8).animation(Motion.hover, value: dropTarget)
    .draggable(item.id) {
      Text(item.name).font(HR.popoverFont(13, .medium)).padding(.horizontal, 10)
        .padding(.vertical, 6).background(HR.raisedSurface, in: RoundedRectangle(cornerRadius: 7))
    }
    .dropDestination(for: String.self) { ids, _ in
      guard let id = ids.first else { return false }
      withAnimation(Motion.expand(reduceMotion)) { model.moveAccount(id: id, onto: item.id) }
      return true
    } isTargeted: { targeted in
      if targeted {
        dropTarget = item.id
      } else if dropTarget == item.id {
        dropTarget = nil
      }
    }
    .accessibilityAction(named: "Move up") { model.moveAccount(item, by: -1) }
    .accessibilityAction(named: "Move down") { model.moveAccount(item, by: 1) }
  }

  private func shown(_ item: AccountItem) -> Binding<Bool> {
    Binding(
      get: { !model.preferences.hiddenAccounts.contains(item.id) },
      set: {
        if $0 {
          model.preferences.hiddenAccounts.remove(item.id)
        } else {
          model.preferences.hiddenAccounts.insert(item.id)
        }
      })
  }

  // MARK: Notifications

  /// "almost_out" reads "Almost out": sentence case, as everywhere else in Settings.
  private func kindLabel(_ kind: NoticeKind) -> String {
    let words = kind.rawValue.replacingOccurrences(of: "_", with: " ")
    return words.prefix(1).uppercased() + words.dropFirst()
  }

  @ViewBuilder private var notifications: some View {
    if model.sources.isEmpty {
      SettingsEmpty(
        symbol: "bell", title: "No notifications yet",
        message: "Notifications come from your sources. Add one, then choose which show as banners."
      ) {
        Button("Add a source", action: addSource).buttonStyle(WebButtonStyle(kind: .primary))
      }
    } else {
      SettingsSections {
        ForEach(noticeGroups, id: \.0) { group in
          SettingsSection(group.0) {
            ForEach(group.1, id: \.self) { kind in
              SettingsRow(title: kindLabel(kind)) {
                Toggle(
                  kindLabel(kind),
                  isOn: Binding(
                    get: { model.enabledKinds[kind.rawValue] != false },
                    set: { value in Task { await model.setKind(kind, enabled: value) } })
                ).toggleStyle(WebSwitchStyle())
              }
            }
          }
        }
      }
    }
  }

  private var noticeGroups: [(String, [NoticeKind])] {
    [
      ("Limits", [.almost_out, .pacing, .running_low]),
      (
        "Money",
        [
          .spend_near_cap, .extra_usage_started, .balance_low, .top_up_detected, .credits_expiring,
          .budget_near, .budget_exceeded, .spend_cap_reached,
        ]
      ),
      ("Resets", [.reset_expiring, .early_reset, .reset_granted, .auto_reset]),
      ("Connection", [.disconnected, .refresh_failed]),
    ]
  }

  // MARK: Sources

  @ViewBuilder private var sources: some View {
    let hasThisMac = model.sources.contains { $0.source.baseURL == LocalServer.url }
    Group {
      if model.sources.isEmpty {
        SettingsEmpty(
          symbol: "server.rack", title: "No sources yet",
          message:
            "Add a Headroom server with a read-only token from its dashboard, Settings, Devices."
        ) {
          Button("Add a source", action: addSource).buttonStyle(WebButtonStyle(kind: .primary))
            .disabled(model.busy)
        }
        if !hasThisMac { SettingsSections { thisMac } }
      } else {
        SettingsSections {
          SettingsSection("Sources") {
            Button("Add a source", action: addSource)
              .buttonStyle(WebButtonStyle(small: true)).disabled(model.busy)
          } content: {
            ForEach(Array(model.sources.enumerated()), id: \.element.id) { index, snapshot in
              sourceRow(snapshot, index: index)
            }
          }
          if !hasThisMac { thisMac }
        }
      }
    }
    .task {
      await model.checkLocal()
      await model.checkRefreshAccess()
    }
  }

  /// The name with its state, then one line of address, version and last read. The address
  /// gives way first, in the middle, so the state and age always show.
  private func sourceRow(_ snapshot: SourceSnapshot, index: Int) -> some View {
    HStack(spacing: 40) {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          Text(snapshot.source.name).font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink)
          HStack(spacing: 5) {
            Circle().fill(stateColor(snapshot.state)).frame(width: 6, height: 6)
            Text(sourceState(snapshot))
          }.font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
        }
        HStack(spacing: 0) {
          Text(address(snapshot.source)).truncationMode(.middle).layoutPriority(-1)
          Text(sourceDetail(snapshot)).fixedSize()
        }.font(HR.popoverFont(12)).foregroundStyle(HR.textMuted).lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
      sourceActions(snapshot, index: index)
    }
    .padding(.vertical, 10)
  }

  /// Sources whose token may change Refresh Every.
  private var refreshWritable: [SourceSnapshot] {
    model.sources.filter { model.refreshAccess[$0.id] == .allowed }
  }

  /// The interval the sources this Mac can change share, or "Mixed".
  private var refreshValue: String {
    let shown = refreshWritable.isEmpty ? model.sources : refreshWritable
    let minutes = Set(shown.compactMap(model.serverRefreshMinutes))
    if minutes.count > 1 { return "Mixed" }
    return minutes.first.map { "\($0) min" } ?? "Not set"
  }

  private static func checkLabel(_ seconds: Int) -> String {
    seconds < 60 ? "\(seconds) sec" : "\(seconds / 60) min"
  }

  /// One line: what the setting does, or which sources it cannot change. The full steps for a
  /// read-only source are in the row's tooltip.
  private var refreshNote: String {
    guard !model.sources.isEmpty else { return "Add a source to set how often it refreshes." }
    let readOnly = model.sources.filter { model.refreshAccess[$0.id] == .readOnly }
      .map(\.source.name)
    guard !readOnly.isEmpty else { return "How often your servers refresh." }
    // Nothing here can change it until one source has a token that may.
    guard !refreshWritable.isEmpty else {
      return "Needs a source whose token can change Refresh Every."
    }
    return "Skips \(ListFormatter.localizedString(byJoining: readOnly)): read-only token."
  }

  /// "Connected · every 10 min · read only": the state, the server's Refresh Every, and whether
  /// this Mac's token may change it.
  private func sourceState(_ snapshot: SourceSnapshot) -> String {
    var parts = [snapshot.state.label]
    if let minutes = model.serverRefreshMinutes(snapshot) { parts.append("every \(minutes) min") }
    if model.refreshAccess[snapshot.id] == .readOnly { parts.append("read only") }
    return parts.joined(separator: " · ")
  }

  /// " · v0.1.13 · Updated 2 min ago", after the address.
  private func sourceDetail(_ snapshot: SourceSnapshot) -> String {
    var parts: [String] = []
    if let version = snapshot.cached?.feed.serverVersion { parts.append("v\(version)") }
    parts.append("Updated \(Formatting.age(model.readAt(snapshot), now: model.now))")
    return parts.map { " · \($0)" }.joined()
  }

  private func stateColor(_ state: SourceState) -> Color {
    switch state {
    case .connected: HR.popoverSuccess
    case .offline, .signedOut: HR.popoverDanger
    case .needsUpdate, .noData: HR.popoverWarning
    }
  }

  private func address(_ source: Source) -> String {
    let url = source.baseURL
    return url.host().map { host in url.port.map { "\(host):\($0)" } ?? host }
      ?? url.absoluteString
  }

  private func sourceActions(_ snapshot: SourceSnapshot, index: Int) -> some View {
    HStack(spacing: 6) {
      Button("Open") { model.openDashboard(snapshot.source) }
        .buttonStyle(WebButtonStyle(small: true))
      Button {
        withAnimation(Motion.expand(reduceMotion)) {
          sourceMenu = sourceMenu == snapshot.id ? nil : snapshot.id
        }
      } label: {
        Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium))
          .foregroundStyle(HR.secondary).frame(width: 30, height: 30).contentShape(Circle())
      }
      .buttonStyle(.plain).fixedSize()
      .anchorPreference(key: SourceMenuAnchors.self, value: .bounds) { [snapshot.id: $0] }
      .disabled(model.busy).accessibilityLabel("More for \(snapshot.source.name)")
    }
  }

  /// The open source menu, drawn like the popover's menus. It opens under its button, or above
  /// it when the window ends first, with its trailing edge on the button's.
  @ViewBuilder private func sourceMenuLayer(_ anchors: [UUID: Anchor<CGRect>]) -> some View {
    GeometryReader { proxy in
      if let id = sourceMenu, let anchor = anchors[id],
        let index = model.sources.firstIndex(where: { $0.id == id })
      {
        let snapshot = model.sources[index]
        let button = proxy[anchor]
        let up = button.maxY + 190 > proxy.size.height
        ZStack(alignment: up ? .bottomTrailing : .topTrailing) {
          // A click anywhere else closes the menu, as a menu does.
          Color.clear.contentShape(Rectangle()).onTapGesture { closeSourceMenu() }
            .accessibilityHidden(true)
          PopoverMenuCard(label: "More for \(snapshot.source.name)") {
            sourceMenuItems(snapshot, index: index)
          }
          .padding(.trailing, proxy.size.width - button.maxX)
          .padding(
            up ? .bottom : .top, up ? proxy.size.height - button.minY + 4 : button.maxY + 4)
        }
        .frame(width: proxy.size.width, height: proxy.size.height)
        .transition(
          .opacity.combined(
            with: .scale(scale: 0.96, anchor: up ? .bottomTrailing : .topTrailing)))
      }
    }
  }

  @ViewBuilder private func sourceMenuItems(_ snapshot: SourceSnapshot, index: Int) -> some View {
    PopoverMenuItem(title: "Refresh now", symbol: "arrow.clockwise") {
      closeSourceMenu()
      Task { await model.readSources() }
    }
    PopoverMenuItem(title: "Edit…", symbol: "pencil") {
      closeSourceMenu()
      editing = SourceDraft(snapshot.source)
    }
    // Only the moves that can happen are offered.
    if index > 0 {
      PopoverMenuItem(title: "Move up", symbol: "arrow.up") {
        closeSourceMenu()
        Task { await model.moveSource(snapshot, by: -1) }
      }
    }
    if index < model.sources.count - 1 {
      PopoverMenuItem(title: "Move down", symbol: "arrow.down") {
        closeSourceMenu()
        Task { await model.moveSource(snapshot, by: 1) }
      }
    }
    PopoverMenuDivider()
    PopoverMenuItem(title: "Remove…", symbol: "trash") {
      closeSourceMenu()
      remove = snapshot
    }
  }

  private func closeSourceMenu() { withAnimation(Motion.expand(reduceMotion)) { sourceMenu = nil } }

  /// This Mac as a source: add it when it answers, start it when installed, else how to install.
  private var thisMac: some View {
    SettingsSection("This Mac") {
      if model.localAvailable {
        SettingsRow(
          title: "Headroom is running",
          note: "Create a token in its dashboard, Settings, Devices, then add it."
        ) {
          Button("Add This Mac") { editing = SourceDraft(local: true) }
            .buttonStyle(WebButtonStyle(small: true)).disabled(model.busy)
        }
      } else if model.localServer != nil || model.localStarting {
        SettingsRow(
          title: "Headroom is not running", note: "Starting it also starts it at every login."
        ) {
          Button(model.localStarting ? "Starting…" : "Start Headroom") {
            Task { await model.startLocal() }
          }
          .buttonStyle(WebButtonStyle(small: true)).disabled(model.localStarting)
        }
      } else {
        SettingsRow(title: "Headroom is not installed", note: Self.installCommand) {
          Button("Copy command") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(Self.installCommand, forType: .string)
          }.buttonStyle(WebButtonStyle(small: true))
        }
      }
    }
  }

  private static let installCommand = "brew install amitray007/headroom/headroom"

  // MARK: General

  /// One sentence on where this copy stands, then when that was learned.
  private var updateNote: String {
    let updates = model.updates
    let running = "Headroom \(updates.running)"
    if updates.checking { return "Checking for a newer version…" }
    let status =
      if let found = updates.available {
        "Headroom \(found.version) is available. You have \(updates.running)."
      } else if updates.lastCheckFailed {
        "\(running). Could not reach GitHub."
      } else if updates.result == .upToDate {
        "\(running) is up to date."
      } else {
        "\(running)."
      }
    guard let at = updates.checkedAt else { return status }
    let when = Formatting.checked(at, now: model.now)
    return "\(status) \(updates.lastCheckFailed ? "Last checked" : "Checked") \(when)."
  }

  private var general: some View {
    SettingsSections {
      SettingsSection("General") {
        SettingsRow(title: "Launch at login", note: "Open Headroom when you log in.") {
          Toggle("Launch at login", isOn: $launchAtLogin).toggleStyle(WebSwitchStyle())
            .onChange(of: launchAtLogin) { _, enabled in
              guard !model.synthetic else { return }
              do {
                if enabled {
                  try SMAppService.mainApp.register()
                } else {
                  try SMAppService.mainApp.unregister()
                }
              } catch {
                launchAtLogin = SMAppService.mainApp.status == .enabled
                model.error =
                  "Could not change login settings. Check System Settings, General, Login Items."
              }
            }
        }
        SettingsRow(title: "Refresh every", note: refreshNote) {
          WebSelect(value: refreshValue) {
            ForEach(RefreshInterval.options, id: \.self) { minutes in
              Button("\(minutes) min") { Task { await model.setRefresh(minutes: minutes) } }
            }
          }
          .disabled(refreshWritable.isEmpty || model.settingRefresh)
          .opacity(refreshWritable.isEmpty ? 0.5 : 1)
        }
        .help(
          "To change a read-only source, create a token with Can Change Refresh Every in its dashboard, Settings, Devices."
        )
        .task { await model.checkRefreshAccess() }
        SettingsRow(title: "Check every", note: "How often this Mac reads your servers.") {
          WebSelect(value: Self.checkLabel(model.preferences.checkSeconds)) {
            ForEach(DisplayPreferences.checkOptions, id: \.self) { seconds in
              Button(Self.checkLabel(seconds)) { model.preferences.checkSeconds = seconds }
            }
          }
        }
        .help("While the menu is open, it reads every 30 seconds, or sooner when this is shorter.")
        SettingsRow(title: "Updates", note: updateNote) {
          Button("Check now") { Task { await model.updates.check() } }
            .buttonStyle(WebButtonStyle(small: true)).disabled(model.updates.checking)
        }
        SettingsRow(
          title: "Check automatically",
          note: "At launch and every 6 hours. Nothing installs until you press Update."
        ) {
          Toggle("Check automatically", isOn: $model.preferences.checkForUpdates)
            .toggleStyle(WebSwitchStyle())
        }
        SettingsRow(
          title: "Show limits as", note: "Room left, or the share used, as on the web."
        ) {
          WebSegmented(
            selection: $model.preferences.limitsView,
            options: [(.left, "Left"), (.used, "Used")])
        }
        SettingsRow(title: "Appearance") {
          WebSegmented(
            selection: $model.preferences.appearance,
            options: DisplayPreferences.Appearance.allCases.map { ($0, $0.rawValue.capitalized) })
        }
      }
      SettingsSection("Privacy") {
        SettingsRow(
          title: "Privacy Mode",
          note: "Blur emails until the pointer is over the account. Saved on this Mac."
        ) {
          Toggle("Privacy Mode", isOn: $model.preferences.privacy).toggleStyle(WebSwitchStyle())
        }
        SettingsRow(
          title: "Demo Mode",
          note:
            "Show made-up accounts, figures and notifications, for screenshots and screen sharing. Your sources keep reading in the background."
        ) {
          Toggle("Demo Mode", isOn: $model.preferences.demo).toggleStyle(WebSwitchStyle())
        }
      }
    }
  }
}

/// Sections of one pane, separated by a subtle rule as `.dsec + .dsec` is on the web.
private struct SettingsSections<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Group(subviews: content) { sections in
        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
          if index > 0 { Rectangle().fill(HR.borderSubtle).frame(height: 1) }
          section
        }
      }
    }
  }
}

private struct SidebarItem: View {
  let title: String
  let selected: Bool
  let action: () -> Void
  @State private var hovered = false
  var body: some View {
    Button(action: action) {
      Text(title).font(HR.popoverFont(14, .medium))
        .foregroundStyle(selected || hovered ? HR.ink : HR.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12)
        .frame(height: 34)
        .background(selected ? HR.muted : .clear, in: Capsule())
        .contentShape(Capsule())
    }
    .buttonStyle(.plain).onHover { hovered = $0 }
    .animation(.easeOut(duration: 0.16), value: hovered)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// A List row's account: the provider's mark, then "Codex Work" with the provider quiet, over
/// the plan, email and source, so two accounts of one provider read apart. Privacy Mode blurs
/// the email until the pointer is over it, as in the popover.
private struct AccountListLabel: View {
  let item: AccountItem
  let privacy: Bool
  @State private var hovered = false

  var body: some View {
    let account = item.account
    let plan = account.plan.map { "\($0) · " } ?? ""
    HStack(spacing: 10) {
      ProviderMark(provider: account.provider.rawValue).frame(width: 16, height: 16)
      VStack(alignment: .leading, spacing: 2) {
        (Text(item.providerName + " ").foregroundStyle(HR.secondary)
          + Text(account.name).foregroundStyle(HR.ink))
          .font(HR.popoverFont(14, .medium))
        // Plan · email · source; the email gives way first.
        HStack(spacing: 0) {
          Text(plan)
          if let identity = account.identity {
            PrivateText(text: identity, hidden: privacy && !hovered).layoutPriority(-1)
            Text(" · ")
          }
          Text(item.snapshot.source.name)
        }
        .font(HR.popoverFont(12)).foregroundStyle(HR.textMuted)
      }
      .lineLimit(1).truncationMode(.middle)
    }
    .onHover { hovered = $0 }
    .accessibilityElement(children: .combine)
  }
}

struct SourceDraft: Identifiable {
  let id = UUID()
  var sourceID: UUID?
  var name = ""
  var url = ""
  init(local: Bool = false) {
    if local {
      name = "This Mac"
      url = "http://127.0.0.1:8080"
    }
  }
  init(_ source: Source) {
    sourceID = source.id
    name = source.name
    url = source.baseURL.absoluteString
  }
}

struct SourceEditor: View {
  let model: AppModel
  @State var draft: SourceDraft
  var close: () -> Void
  @State private var token = ""
  @State private var error: String?
  @State private var saving = false
  @FocusState private var focused: Field?
  private enum Field { case name, url, token }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(draft.sourceID == nil ? "Add a source" : "Edit source").font(HR.popoverFont(16, .medium))
        .accessibilityAddTraits(.isHeader)
      WebField(label: "Name") {
        TextField("Home server", text: $draft.name).focused($focused, equals: .name)
          .accessibilityLabel("Source name")
      }
      WebField(label: "URL") {
        TextField("https://headroom.example.com", text: $draft.url).focused($focused, equals: .url)
          .accessibilityLabel("Source URL")
      }
      WebField(label: draft.sourceID == nil ? "Read-only token" : "New token") {
        SecureField(
          draft.sourceID == nil ? "hr_…" : "Leave empty to keep the saved token", text: $token
        )
        .focused($focused, equals: .token).accessibilityLabel("Read-only source token")
      }
      VStack(alignment: .leading, spacing: 4) {
        Text(
          "Create a token in this source's dashboard, Settings, Devices. It stays in this Mac's Keychain. A new URL needs a new token."
        )
        .font(HR.popoverFont(12)).foregroundStyle(HR.textMuted).lineSpacing(1.5)
        .fixedSize(horizontal: false, vertical: true)
        if let dashboard = URL(string: draft.url), ["http", "https"].contains(dashboard.scheme),
          dashboard.host() != nil
        {
          Button("Open this source's dashboard") { NSWorkspace.shared.open(dashboard) }
            .buttonStyle(WebButtonStyle(kind: .quiet, small: true)).padding(.leading, -12)
        }
      }
      if let error {
        Text(error).font(HR.popoverFont(13)).foregroundStyle(HR.danger)
          .fixedSize(horizontal: false, vertical: true).accessibilityLabel("Error: \(error)")
      }
      HStack(spacing: 12) {
        Spacer()
        Button("Cancel") {
          token = ""
          close()
        }
        .buttonStyle(WebButtonStyle()).keyboardShortcut(.cancelAction)
        Button(saving ? "Verifying…" : "Verify and save") { Task { await save() } }
          .buttonStyle(WebButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
          .disabled(saving || model.busy || model.synthetic)
      }.padding(.top, 4)
    }.padding(24).frame(width: 440).font(HR.popoverFont(14))
      .foregroundStyle(HR.ink).background(HR.raisedSurface)
      .task { focused = .name }
      .onDisappear { token = "" }
      .interactiveDismissDisabled(saving)
  }
  private func save() async {
    saving = true
    error = nil
    defer { saving = false }
    do {
      try await model.saveSource(id: draft.sourceID, name: draft.name, url: draft.url, token: token)
      token = ""
      close()
    } catch let setup as SourceSetupError {
      error = setup.localizedDescription
      focused =
        setup == .nameRequired
        ? .name : setup == .tokenRequired || setup == .rejectedToken ? .token : .url
    } catch let source as SourceError {
      error =
        source == .insecureURL
        ? "Use HTTPS, or a local network HTTP address."
        : "Enter a valid server URL without a username, query or fragment."
      focused = .url
    } catch {
      self.error = "Could not save this source on this Mac. Your previous settings have been kept."
    }
  }
}

extension View {
  /// The pane scrolls under the transparent title bar. macOS 26 blurs content under window
  /// chrome and rules it off, which turned the pane title into a frosted band.
  @ViewBuilder fileprivate func hidingTopScrollEdge() -> some View {
    if #available(macOS 26, *) {
      scrollEdgeEffectHidden(true, for: .top)
    } else {
      self
    }
  }
}

/// Runs the Settings content under a transparent title bar and sets the close, minimize and zoom
/// buttons in from the corner. Without help macOS puts them tight in the rounded corner; an empty
/// toolbar moved them, but on macOS 26 it also frosted the pane under it on hover.
private struct SettingsWindowChrome: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView { ChromeView() }
  func updateNSView(_ view: NSView, context: Context) {}

  private final class ChromeView: NSView {
    /// The title bar height and the leading edge of the close button.
    static let barHeight: CGFloat = 48
    static let leading: CGFloat = 18
    private var observers: [NSObjectProtocol] = []
    private var placing = false

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      guard let window else { return }
      window.titleVisibility = .hidden
      window.titlebarAppearsTransparent = true
      window.titlebarSeparatorStyle = .none
      window.styleMask.insert(.fullSizeContentView)
      // AppKit lays the title bar out again on resize, key changes and full screen; each time
      // it moves the buttons back, so place them again whenever their frames change.
      var watched: [NSView] = [WindowButtons.container(of: window)].compactMap { $0 }
      watched += WindowButtons.all(of: window)
      for view in watched {
        view.postsFrameChangedNotifications = true
        observers.append(
          NotificationCenter.default.addObserver(
            forName: NSView.frameDidChangeNotification, object: view, queue: .main
          ) { [weak self] _ in MainActor.assumeIsolated { self?.place() } })
      }
      for name in [NSWindow.didResizeNotification, NSWindow.didBecomeKeyNotification] {
        observers.append(
          NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) {
            [weak self] _ in MainActor.assumeIsolated { self?.place() }
          })
      }
      place()
      Task { @MainActor [weak self] in self?.place() }
    }

    private func place() {
      guard !placing, let window, let container = WindowButtons.container(of: window) else {
        return
      }
      placing = true
      defer { placing = false }
      var frame = container.frame
      frame.size.height = Self.barHeight
      frame.origin.y = window.frame.height - Self.barHeight
      if container.frame != frame { container.frame = frame }
      let buttons = WindowButtons.all(of: window)
      // Keep macOS's own spacing between the three buttons.
      let step = buttons.count > 1 ? buttons[1].frame.minX - buttons[0].frame.minX : 20
      for (index, button) in buttons.enumerated() {
        let origin = NSPoint(
          x: Self.leading + CGFloat(index) * step,
          y: ((Self.barHeight - button.frame.height) / 2).rounded())
        if button.frame.origin != origin { button.setFrameOrigin(origin) }
      }
    }
  }

  @MainActor private enum WindowButtons {
    static func all(of window: NSWindow) -> [NSButton] {
      [.closeButton, .miniaturizeButton, .zoomButton].compactMap {
        window.standardWindowButton($0)
      }
    }
    /// The title bar container: the close button sits in the title bar view inside it.
    static func container(of window: NSWindow) -> NSView? {
      window.standardWindowButton(.closeButton)?.superview?.superview
    }
  }
}

/// The menu bar item as it will look, beside stand-ins for the system items, on a bar the width
/// of the card: 1.5x when it fits, smaller when three wide accounts and the clock would not.
private struct MenuBarPreview: View {
  let status: MenuStatus
  @State private var size = CGSize.zero
  @State private var room: CGFloat = 0
  private static let bar = HR.color(light: 0xE4E5E9, dark: 0x1D2030)

  private var scale: CGFloat {
    guard size.width > 0, room > 0 else { return 1.5 }
    return min(1.5, room / size.width)
  }

  var body: some View {
    // The bar spans the card like the real menu bar, with the items at its trailing edge. The
    // items draw over it, so their natural width never widens the pane.
    RoundedRectangle(cornerRadius: 5 * scale).fill(Self.bar)
      .frame(height: max(24, size.height) * scale)
      .onGeometryChange(for: CGFloat.self) {
        $0.size.width
      } action: {
        room = $0
      }
      .overlay(alignment: .trailing) {
        strip.fixedSize()
          .onGeometryChange(for: CGSize.self) {
            $0.size
          } action: {
            size = $0
          }
          .scaleEffect(scale, anchor: .trailing)
      }
      .padding(14).background(HR.muted, in: RoundedRectangle(cornerRadius: 12))
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Preview: \(status.summary)")
  }

  private var strip: some View {
    HStack(spacing: 14) {
      MenuItemLabel(status: status)
      Group {
        Image(systemName: "wifi")
        Image(systemName: "battery.75percent").font(.system(size: 15))
        Text(Date.now.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
      }.accessibilityHidden(true)
    }
    .font(.system(size: 13, weight: .medium)).foregroundStyle(.primary)
    .padding(.horizontal, 10).frame(height: 24)
  }
}

/// Where each source's More button sits, so its menu lines up with it.
private struct SourceMenuAnchors: PreferenceKey {
  static let defaultValue: [UUID: Anchor<CGRect>] = [:]
  static func reduce(
    value: inout [UUID: Anchor<CGRect>], nextValue: () -> [UUID: Anchor<CGRect>]
  ) {
    value.merge(nextValue()) { $1 }
  }
}
