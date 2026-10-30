import AppKit
import HeadroomKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @State private var editing: SourceDraft?
  @State private var remove: SourceSnapshot?
  @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(spacing: 0) {
      VStack(spacing: 2) {
        ForEach(SettingsPane.allCases) { pane in
          SidebarItem(title: pane.rawValue, selected: model.selectedPane == pane) {
            withAnimation(.easeOut(duration: 0.18)) { model.selectedPane = pane }
          }
        }
        Spacer()
      }
      .padding(.horizontal, 10).padding(.top, 12).frame(width: 165)
      .background(HR.background)
      .overlay(alignment: .trailing) { Rectangle().fill(HR.borderSubtle).frame(width: 1) }
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text(model.selectedPane.rawValue).font(HR.popoverFont(16, .medium))
            .frame(height: 34).padding(.horizontal, 24).accessibilityAddTraits(.isHeader)
          switch model.selectedPane {
          case .menuBar: menuBar
          case .list: accountList
          case .notifications: notifications
          case .sources: sources
          case .general: general
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12).padding(.bottom, 24)
      }
      .scrollIndicators(.never).id(model.selectedPane)
      .transition(Motion.reveal(reduceMotion))
      .background(HR.raisedSurface)
    }
    .font(HR.popoverFont(14)).foregroundStyle(HR.ink).tint(HR.ink)
    .frame(width: 700, height: 598)
    // The title sat across the sidebar edge; each pane already names itself.
    .toolbar(removing: .title)
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
        "Its saved token, readings and notice history will be removed from this Mac. The server and its accounts stay linked."
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
    SettingsSections {
      SettingsSection("Style") {
        LazyVGrid(columns: [.init(.flexible(), spacing: 10), .init(.flexible())], spacing: 10) {
          ForEach(DisplayPreferences.ItemStyle.allCases, id: \.self) { style in
            StyleCard(model: model, style: style, selected: model.preferences.itemStyle == style) {
              model.preferences.itemStyle = style
              if style == .pinned && model.preferences.followedAccount == nil {
                model.preferences.followedAccount = model.allAccounts.first?.id
              }
            }
          }
        }.padding(.vertical, 8)
      }
      SettingsSection("Follow") {
        SettingsRow(title: "Account", note: "The menu bar shows this account's room.") {
          WebSelect(value: followedName) {
            Button("Tightest account with room") { model.preferences.followedAccount = nil }
            if !model.allAccounts.isEmpty { Divider() }
            ForEach(model.allAccounts) { item in
              Button("\(item.name) · \(item.snapshot.source.name)") {
                model.preferences.followedAccount = item.id
              }
            }
          }
        }
      }
    }
  }

  private var followedName: String {
    guard let id = model.preferences.followedAccount,
      let item = model.allAccounts.first(where: { $0.id == id })
    else { return "Tightest account with room" }
    return item.name
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
          ForEach(Array(model.allAccounts.enumerated()), id: \.element.id) { index, item in
            SettingsRow(title: item.name, note: accountNote(item)) {
              HStack(spacing: 2) {
                Button {
                  model.moveAccount(item, by: -1)
                } label: {
                  Image(systemName: "arrow.up")
                }
                .disabled(index == 0).accessibilityLabel("Move \(item.name) up")
                Button {
                  model.moveAccount(item, by: 1)
                } label: {
                  Image(systemName: "arrow.down")
                }
                .disabled(index == model.allAccounts.count - 1)
                .accessibilityLabel("Move \(item.name) down")
                Toggle("Show \(item.name)", isOn: shown(item)).toggleStyle(WebSwitchStyle())
                  .padding(.leading, 10)
              }.buttonStyle(WebIconButtonStyle())
            }
          }
        }
      }
    }
  }

  private func accountNote(_ item: AccountItem) -> String {
    let provider = Presentation.providerName(item.account.provider.rawValue)
    return Presentation.needsSource(item, among: model.allAccounts)
      ? "\(provider) · \(item.snapshot.source.name)" : provider
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
        symbol: "bell", title: "No notices yet",
        message: "Notices come from your sources. Add one, then choose which show as banners."
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
    .task { await model.checkLocal() }
  }

  private func sourceRow(_ snapshot: SourceSnapshot, index: Int) -> some View {
    SettingsRow(title: snapshot.source.name, note: sourceNote(snapshot)) {
      HStack(spacing: 6) {
        Button("Open") { model.openDashboard(snapshot.source) }
          .buttonStyle(WebButtonStyle(small: true))
        Menu {
          Button("Edit") { editing = SourceDraft(snapshot.source) }
          Button("Move up") { Task { await model.moveSource(snapshot, by: -1) } }
            .disabled(index == 0)
          Button("Move down") { Task { await model.moveSource(snapshot, by: 1) } }
            .disabled(index == model.sources.count - 1)
          Divider()
          Button("Remove…", role: .destructive) { remove = snapshot }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium))
            .foregroundStyle(HR.secondary).frame(width: 30, height: 30).contentShape(Circle())
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        .disabled(model.busy).accessibilityLabel("More for \(snapshot.source.name)")
      }
    }
  }

  private func sourceNote(_ snapshot: SourceSnapshot) -> String {
    let url = snapshot.source.baseURL
    let address = url.host().map { host in url.port.map { "\(host):\($0)" } ?? host }
    return [
      address ?? url.absoluteString, snapshot.state.label,
      "Updated \(Formatting.age(snapshot.cached?.readAt, now: model.now))",
      snapshot.cached?.feed.serverVersion,
    ].compactMap(\.self).joined(separator: " · ")
  }

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
        SettingsRow(title: "Read sources", note: "Every 2 minutes, every 30 seconds while open.") {
          EmptyView()
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
            "Show made-up accounts, figures and notices, for screenshots and screen sharing. Your sources keep reading in the background."
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

/// Arc's radio card: a 20 pt card, a ring and a filled dot on the chosen one.
private struct StyleCard: View {
  let model: AppModel
  let style: DisplayPreferences.ItemStyle
  let selected: Bool
  let action: () -> Void
  @State private var hovered = false
  var body: some View {
    Button(action: action) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 10) {
          MenuItemLabel(model: model, style: style, sample: true).frame(height: 23)
          Text(style.label).font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink)
        }
        Spacer(minLength: 8)
        ZStack {
          Circle().fill(selected ? HR.accent : .clear)
          Circle().strokeBorder(selected ? HR.accent : HR.borderStrong, lineWidth: 1.5)
          Circle().fill(HR.surface).frame(width: 6, height: 6).scaleEffect(selected ? 1 : 0)
        }.frame(width: 18, height: 18).padding(.top, 2)
      }
      .padding(.horizontal, 16).padding(.vertical, 14)
      .background(selected ? HR.muted.opacity(0.5) : HR.surface, in: card)
      .overlay(
        card.strokeBorder(
          selected ? HR.accent : hovered ? HR.borderStrong : HR.border,
          lineWidth: selected ? 1.5 : 1)
      )
      .contentShape(card)
    }
    .buttonStyle(.plain).onHover { hovered = $0 }
    .animation(.spring(response: 0.4, dampingFraction: 0.7), value: selected)
    .accessibilityLabel(style.label).accessibilityAddTraits(selected ? .isSelected : [])
  }
  private var card: RoundedRectangle { RoundedRectangle(cornerRadius: 20, style: .continuous) }
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
