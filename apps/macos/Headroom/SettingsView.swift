import AppKit
import HeadroomKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  @State private var editing: SourceDraft?
  @State private var remove: SourceSnapshot?
  @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

  var body: some View {
    HStack(spacing: 0) {
      VStack(spacing: 0) {
        ForEach(SettingsPane.allCases) { pane in
          Button {
            model.selectedPane = pane
          } label: {
            Text(pane.rawValue).font(
              .system(size: 13, weight: model.selectedPane == pane ? .semibold : .regular)
            )
            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 9).padding(
              .vertical, 9
            )
            .background(
              model.selectedPane == pane ? HR.muted : .clear, in: RoundedRectangle(cornerRadius: 7)
            )
            .contentShape(Rectangle())
          }.buttonStyle(.plain).accessibilityAddTraits(
            model.selectedPane == pane ? .isSelected : [])
        }
        Spacer()
      }.padding(.horizontal, 10).padding(.top, 14).frame(width: 165).background(
        HR.muted.opacity(0.6))
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(model.selectedPane.rawValue).font(HR.font(16, .semibold)).accessibilityAddTraits(
            .isHeader)
          switch model.selectedPane {
          case .menuBar: menuBar
          case .list: accountList
          case .notifications: notifications
          case .sources: sources
          case .general: general
          }
          Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 25).padding(
          .vertical, 20)
      }.id(model.selectedPane)
    }
    .font(HR.font()).foregroundStyle(HR.ink).background(HR.background).tint(HR.ink)
    .frame(width: 700, height: 598)
    .preferredColorScheme(model.colorScheme)
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

  private var menuBar: some View {
    VStack(alignment: .leading, spacing: 12) {
      LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 8) {
        ForEach(DisplayPreferences.ItemStyle.allCases, id: \.self) { style in
          Button {
            model.preferences.itemStyle = style
            if style == .pinned && model.preferences.followedAccount == nil {
              model.preferences.followedAccount = model.allAccounts.first?.id
            }
          } label: {
            VStack(alignment: .leading, spacing: 10) {
              MenuItemLabel(model: model, style: style, sample: true).frame(height: 23)
              Text(style.label).font(HR.font(12))
            }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
              .background(HR.muted, in: RoundedRectangle(cornerRadius: 7))
              .overlay(
                RoundedRectangle(cornerRadius: 7).strokeBorder(
                  model.preferences.itemStyle == style ? HR.ink : HR.border))
          }.buttonStyle(.plain).accessibilityLabel(style.label)
            .accessibilityAddTraits(model.preferences.itemStyle == style ? .isSelected : [])
        }
      }
      settingsGroup {
        HStack {
          Text("Follow")
          Spacer()
          Picker("Follow", selection: $model.preferences.followedAccount) {
            Text("Tightest account with room").tag(String?.none)
            ForEach(model.allAccounts) { item in
              Text("\(item.name) · \(item.snapshot.source.name)").tag(Optional(item.id))
            }
          }.labelsHidden().frame(maxWidth: 270)
        }.padding(.vertical, 10)
      }
      hint(
        "Follow one account, or the tightest account that still has room. A dot marks unread notices, or an account that is out or signed out."
      )
    }
  }

  private var accountList: some View {
    VStack(alignment: .leading, spacing: 0) {
      hint("Hide accounts or change their order with the buttons.").padding(.bottom, 12)
      if model.allAccounts.isEmpty {
        hint("Accounts appear after a source sends its first readings.")
      } else {
        settingsGroup {
          ForEach(Array(model.allAccounts.enumerated()), id: \.element.id) { index, item in
            HStack {
              Toggle(
                isOn: Binding(
                  get: { !model.preferences.hiddenAccounts.contains(item.id) },
                  set: {
                    if $0 {
                      model.preferences.hiddenAccounts.remove(item.id)
                    } else {
                      model.preferences.hiddenAccounts.insert(item.id)
                    }
                  })
              ) {
                Text(
                  item.name
                    + (Presentation.needsSource(item, among: model.allAccounts)
                      ? " · \(item.snapshot.source.name)" : ""))
              }.toggleStyle(.checkbox)
              Spacer()
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
              .disabled(index == model.allAccounts.count - 1).accessibilityLabel(
                "Move \(item.name) down")
            }.padding(.vertical, 10)
            if index != model.allAccounts.count - 1 { Divider().overlay(HR.border) }
          }
        }
      }
    }
  }

  /// "almost_out" reads "Almost out": sentence case, as everywhere else in Settings.
  private func kindLabel(_ kind: NoticeKind) -> String {
    let words = kind.rawValue.replacingOccurrences(of: "_", with: " ")
    return words.prefix(1).uppercased() + words.dropFirst()
  }

  private var notifications: some View {
    VStack(alignment: .leading, spacing: 16) {
      hint("Delivery switches apply to this Mac. Collection and owner rules stay on each server.")
      ForEach(noticeGroups, id: \.0) { group in
        Text(group.0).hrHeading()
        settingsGroup {
          ForEach(Array(group.1.enumerated()), id: \.element) { index, kind in
            HStack {
              Text(kindLabel(kind))
              Spacer()
              Toggle(
                kindLabel(kind),
                isOn: Binding(
                  get: { model.enabledKinds[kind.rawValue] != false },
                  set: { value in Task { await model.setKind(kind, enabled: value) } })
              )
              .labelsHidden().toggleStyle(.checkbox)
            }.padding(.vertical, 10)
            if index != group.1.count - 1 { Divider().overlay(HR.border) }
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

  private var sources: some View {
    VStack(alignment: .leading, spacing: 16) {
      hint("Sign in through each source's web dashboard.")
      ForEach(Array(model.sources.enumerated()), id: \.element.id) { index, snapshot in
        settingsGroup {
          HStack {
            Text("Name")
            Spacer()
            Text(snapshot.source.name).textSelection(.enabled)
          }.padding(.vertical, 10)
          Divider().overlay(HR.border)
          HStack(alignment: .top) {
            Text("URL")
            Spacer()
            Text(snapshot.source.baseURL.absoluteString).textSelection(.enabled).lineLimit(2)
              .frame(maxWidth: 300, alignment: .trailing)
          }.padding(.vertical, 10)
          Divider().overlay(HR.border)
          hint(
            "\(snapshot.state.label) · Updated \(Formatting.age(snapshot.cached?.readAt, now: model.now)) · \(snapshot.cached?.feed.serverVersion ?? "Version unknown")"
          )
          .padding(.vertical, 8)
          HStack(spacing: 8) {
            Button("Open in web dashboard") { model.openDashboard(snapshot.source) }
            Button("Edit") { editing = SourceDraft(snapshot.source) }.disabled(model.busy)
            Button {
              Task { await model.moveSource(snapshot, by: -1) }
            } label: {
              Image(systemName: "arrow.up")
            }
            .disabled(index == 0 || model.busy).accessibilityLabel(
              "Move \(snapshot.source.name) up")
            Button {
              Task { await model.moveSource(snapshot, by: 1) }
            } label: {
              Image(systemName: "arrow.down")
            }
            .disabled(index == model.sources.count - 1 || model.busy).accessibilityLabel(
              "Move \(snapshot.source.name) down")
            Button("Remove") { remove = snapshot }
          }.controlSize(.small).padding(.bottom, 12)
        }
      }
      HStack {
        Button("Add a source") { editing = SourceDraft() }
        if model.localAvailable
          && !model.sources.contains(where: {
            $0.source.baseURL.absoluteString == "http://127.0.0.1:8080"
          })
        {
          Button("Add This Mac") { editing = SourceDraft(local: true) }
        }
      }.disabled(model.busy)
      if model.sources.isEmpty {
        hint(
          "Create a read-only token in your server's Settings, Devices. Paste it here with the server URL."
        )
      }
    }
  }

  private var general: some View {
    VStack(alignment: .leading, spacing: 12) {
      settingsGroup {
        HStack {
          Text("Launch at login")
          Spacer()
          Toggle("Launch at login", isOn: $launchAtLogin).labelsHidden().toggleStyle(.checkbox)
        }.padding(.vertical, 10)
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
        Divider().overlay(HR.border)
        HStack {
          Text("Read sources")
          Spacer()
          Text("Every 2 min · 30 sec while open")
        }.padding(.vertical, 10)
        Divider().overlay(HR.border)
        HStack {
          Text("Appearance")
          Spacer()
          Picker("Appearance", selection: $model.preferences.appearance) {
            ForEach(DisplayPreferences.Appearance.allCases, id: \.self) {
              Text($0.rawValue.capitalized).tag($0)
            }
          }.labelsHidden().fixedSize()
        }.padding(.vertical, 10)
      }
      hint(
        "Readings are read-only. Collection runs on each server and never sends a model request.")
    }
  }

  private func settingsGroup<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 0, content: content).padding(.horizontal, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(HR.border))
  }
  private func hint(_ text: String) -> some View {
    Text(text).font(HR.font(12)).foregroundStyle(HR.secondary).fixedSize(
      horizontal: false, vertical: true)
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
      Text(draft.sourceID == nil ? "Add a source" : "Edit source").font(HR.font(16, .semibold))
        .accessibilityAddTraits(.isHeader)
      TextField("Name", text: $draft.name).focused($focused, equals: .name)
        .accessibilityLabel("Source name")
      TextField("URL", text: $draft.url).focused($focused, equals: .url)
        .accessibilityLabel("Source URL")
      SecureField(
        draft.sourceID == nil ? "Read-only token" : "New token (leave empty to keep)", text: $token
      )
      .focused($focused, equals: .token).accessibilityLabel("Read-only source token")
      Text(
        "Create a token in this source's Settings, Devices. It stays in this Mac's Keychain. Changing the URL requires a new token."
      )
      .font(HR.font(12)).foregroundStyle(HR.secondary)
      if let error {
        Text(error).font(HR.font(12)).foregroundStyle(HR.danger).accessibilityLabel(
          "Error: \(error)")
      }
      HStack {
        Button("Cancel") {
          token = ""
          close()
        }.keyboardShortcut(.cancelAction)
        Spacer()
        if saving { ProgressView().controlSize(.small).accessibilityLabel("Verifying source") }
        Button(saving ? "Verifying…" : "Verify and save") { Task { await save() } }
          .keyboardShortcut(.defaultAction).disabled(saving || model.busy || model.synthetic)
      }
    }.padding(24).frame(width: 440).font(HR.font()).textFieldStyle(.roundedBorder)
      .foregroundStyle(HR.ink).background(HR.surface).preferredColorScheme(model.colorScheme)
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
