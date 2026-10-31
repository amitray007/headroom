import AppKit
import HeadroomKit
import SwiftUI

/// The Share window's sidebar: accounts, style, limit, size, theme, backdrop and privacy.
struct ShareChoices: View {
  let rows: [LedgerRow]
  let session: ShareSession
  let snapshot: ShareSnapshot
  /// Applies an edit to the open window's look and to the saved look.
  let change: ((inout ShareOptions) -> Void) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      group("ACCOUNTS") { ShareTree(rows: rows, session: session) }
      group("STYLE") { styles }
      group("LIMIT") {
        ShareSegments(
          name: "Limit", values: ShareOptions.Window.allCases, label: \.label,
          selection: binding(\.window))
      }
      HStack(alignment: .top, spacing: 12) {
        group("SIZE") {
          ShareSegments(
            name: "Size", values: ShareOptions.Size.allCases, label: \.label,
            selection: binding(\.size))
        }
        group("THEME") {
          ShareSegments(
            name: "Theme", values: ShareOptions.Theme.allCases, label: { $0.rawValue.capitalized },
            selection: binding(\.theme))
        }
      }
      group("BACKDROP") { backdrops }
      group("PRIVACY") {
        VStack(alignment: .leading, spacing: 7) {
          ShareCheck(title: "Hide account names", on: binding(\.hideNames))
          ShareCheck(title: "Hide emails", on: binding(\.hideEmails))
          ShareCheck(title: "Hide credits and balances", on: binding(\.hideMoney))
          ShareCheck(title: "Show the time", on: binding(\.showTime))
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }

  private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content)
    -> some View
  {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(HR.popoverFont(11, .semibold)).foregroundStyle(HR.secondary)
        .accessibilityAddTraits(.isHeader)
      content()
    }
  }

  private func binding<Value>(_ path: WritableKeyPath<ShareOptions, Value>) -> Binding<Value> {
    Binding(
      get: { session.options[keyPath: path] },
      set: { value in change { $0[keyPath: path] = value } })
  }

  // MARK: Style

  private var styles: some View {
    LazyVGrid(
      columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)],
      spacing: 8
    ) {
      ForEach(ShareOptions.Style.allCases, id: \.self) { style in
        let off = style == .spotlight && snapshot.entries.count > ShareOptions.spotlightLimit
        ShareStyleTile(
          style: style, selected: snapshot.style == style, disabled: off,
          note: off ? "Pick \(ShareOptions.spotlightLimit) or fewer" : Self.note(style)
        ) { change { $0.style = style } }
      }
    }
  }

  private static func note(_ style: ShareOptions.Style) -> String {
    switch style {
    case .ledger: "Every limit"
    case .room: "One column each"
    case .spotlight: "Up to \(ShareOptions.spotlightLimit) accounts"
    case .strip: "One line"
    }
  }

  // MARK: Backdrop

  private var backdrops: some View {
    HStack(spacing: 10) {
      ForEach(ShareOptions.Backdrop.allCases, id: \.self) { backdrop in
        let on = session.options.backdrop == backdrop
        Button {
          change { $0.backdrop = backdrop }
        } label: {
          VStack(spacing: 5) {
            swatch(backdrop).frame(width: 44, height: 30)
              .clipShape(RoundedRectangle(cornerRadius: 7))
              .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(HR.border))
              .padding(4)
              .overlay {
                if on {
                  RoundedRectangle(cornerRadius: 10).strokeBorder(Color.accentColor, lineWidth: 2)
                }
              }
            Text(backdrop.label).font(HR.popoverFont(11))
              .foregroundStyle(on ? HR.ink : HR.secondary)
          }
        }.buttonStyle(.plain).accessibilityLabel("\(backdrop.label) backdrop")
          .accessibilityAddTraits(on ? .isSelected : [])
      }
    }
  }

  @ViewBuilder private func swatch(_ backdrop: ShareOptions.Backdrop) -> some View {
    switch backdrop {
    case .none:
      // A checkerboard says "see-through".
      Canvas { context, size in
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(HR.surface))
        for row in 0..<Int(size.height / 10 + 1) {
          for column in 0..<Int(size.width / 10 + 1) where (row + column) % 2 == 0 {
            context.fill(
              Path(CGRect(x: CGFloat(column) * 10, y: CGFloat(row) * 10, width: 10, height: 10)),
              with: .color(HR.track))
          }
        }
      }
    case .mist:
      LinearGradient(
        colors: ShareBackdropColors.mist, startPoint: .topLeading, endPoint: .bottomTrailing)
    case .ink:
      LinearGradient(
        colors: ShareBackdropColors.ink, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
  }
}

// MARK: - Accounts

/// All accounts, then each provider with its accounts. A provider with one account is a single
/// row; with more, its accounts follow with their tightest figure.
private struct ShareTree: View {
  let rows: [LedgerRow]
  let session: ShareSession

  private struct Provider: Identifiable {
    let id: String
    let rows: [LedgerRow]
  }

  private var providers: [Provider] {
    var order: [String] = []
    var byProvider: [String: [LedgerRow]] = [:]
    for row in rows {
      let provider = row.item.account.provider.rawValue
      if byProvider[provider] == nil { order.append(provider) }
      byProvider[provider, default: []].append(row)
    }
    return order.map { Provider(id: $0, rows: byProvider[$0] ?? []) }
  }

  var body: some View {
    let picked = session.selected
    // Each account's tightest limit, worked out the way the picture works it out.
    let tightest = Dictionary(
      ShareSnapshot(
        rows: rows, selected: Set(rows.map(\.id)), options: ShareOptions(),
        now: rows.first?.now ?? .now
      ).entries.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let count = rows.filter { picked.contains($0.id) }.count
    VStack(spacing: 1) {
      node(
        state: state(count, of: rows.count), indent: false, count: "\(count) of \(rows.count)",
        label: "All accounts", weight: .medium
      ) {
        session.selected = count == rows.count ? [] : Set(rows.map(\.id))
      }
      ForEach(providers) { provider in
        let n = provider.rows.filter { picked.contains($0.id) }.count
        node(
          state: state(n, of: provider.rows.count), indent: false,
          count: provider.rows.count > 1 ? "\(n)/\(provider.rows.count)" : nil,
          label: Presentation.providerName(provider.id), mark: provider.id
        ) {
          let ids = Set(provider.rows.map(\.id))
          if n == provider.rows.count {
            session.selected.subtract(ids)
          } else {
            session.selected.formUnion(ids)
          }
        }
        if provider.rows.count > 1 {
          ForEach(provider.rows) { row in
            let entry = tightest[row.id]
            node(
              state: picked.contains(row.id) ? .on : .off, indent: true, count: nil,
              label: row.item.account.name, figure: entry?.tightest?.value,
              figureTone: entry?.tone
            ) {
              if picked.contains(row.id) {
                session.selected.remove(row.id)
              } else {
                session.selected.insert(row.id)
              }
            }
          }
        }
      }
    }
  }

  private func state(_ picked: Int, of total: Int) -> ShareCheckState {
    picked == 0 ? .off : picked == total ? .on : .mixed
  }

  private func node(
    state: ShareCheckState, indent: Bool, count: String?, label: String,
    weight: Font.Weight = .regular, mark: String? = nil, figure: String? = nil,
    figureTone: LedgerRow.Tone? = nil, action: @escaping () -> Void
  ) -> some View {
    ShareNode(
      state: state, indent: indent, count: count, label: label, weight: weight, mark: mark,
      figure: figure, figureTone: figureTone, action: action)
  }
}

private struct ShareNode: View {
  let state: ShareCheckState
  let indent: Bool
  let count: String?
  let label: String
  let weight: Font.Weight
  let mark: String?
  let figure: String?
  let figureTone: LedgerRow.Tone?
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        ShareBox(state: state)
        if let mark { ProviderMark(provider: mark).frame(width: 16, height: 16) }
        Text(label).font(HR.popoverFont(12.5, weight)).lineLimit(1).truncationMode(.tail)
        Spacer(minLength: 4)
        if let count {
          Text(count).font(HR.popoverFont(11.5)).foregroundStyle(HR.textMuted)
        }
        if let figure {
          Text(figure).font(HR.popoverFont(11.5)).foregroundStyle(tone)
        }
      }
      .padding(.leading, indent ? 30 : 6).padding(.trailing, 6).frame(height: 28)
      .background(hovered ? HR.muted : .clear, in: RoundedRectangle(cornerRadius: 6))
      .contentShape(Rectangle())
    }.buttonStyle(.plain).onHover { hovered = $0 }
      .accessibilityLabel(label)
      .accessibilityValue(
        state == .on ? "Selected" : state == .mixed ? "Partly selected" : "Not selected"
      )
      .accessibilityAddTraits(.isToggle)
  }

  private var tone: Color {
    switch figureTone {
    case .out: HR.popoverDanger
    case .tight: HR.popoverWarning
    default: HR.textMuted
    }
  }
}

// MARK: - Controls

enum ShareCheckState { case off, on, mixed }

private struct ShareBox: View {
  let state: ShareCheckState
  var body: some View {
    RoundedRectangle(cornerRadius: 4)
      .fill(state == .off ? HR.surface : Color.accentColor)
      .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(state == .off ? HR.border : .clear))
      .overlay {
        switch state {
        case .on: Image(systemName: "checkmark").font(.system(size: 9, weight: .bold))
        case .mixed: Image(systemName: "minus").font(.system(size: 9, weight: .bold))
        case .off: EmptyView()
        }
      }
      .foregroundStyle(.white).frame(width: 15, height: 15).accessibilityHidden(true)
  }
}

private struct ShareCheck: View {
  let title: String
  @Binding var on: Bool
  var body: some View {
    Button {
      on.toggle()
    } label: {
      HStack(spacing: 8) {
        ShareBox(state: on ? .on : .off)
        Text(title).font(HR.popoverFont(12.5))
        Spacer(minLength: 0)
      }.contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityLabel(title)
      .accessibilityValue(on ? "On" : "Off").accessibilityAddTraits(.isToggle)
  }
}

private struct ShareSegments<Value: Hashable>: View {
  let name: String
  let values: [Value]
  let label: (Value) -> String
  @Binding var selection: Value

  var body: some View {
    HStack(spacing: 0) {
      ForEach(values, id: \.self) { value in
        let on = selection == value
        Button {
          selection = value
        } label: {
          Text(label(value)).font(HR.popoverFont(12, .medium))
            .foregroundStyle(on ? HR.ink : HR.secondary)
            .frame(maxWidth: .infinity).frame(height: 24)
            .background {
              if on {
                RoundedRectangle(cornerRadius: 5).fill(HR.surface)
                  .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
              }
            }.contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(label(value))
          .accessibilityAddTraits(on ? .isSelected : [])
      }
    }.padding(2).background(HR.muted, in: RoundedRectangle(cornerRadius: 7))
      .accessibilityElement(children: .contain).accessibilityLabel(name)
  }
}

private struct ShareStyleTile: View {
  let style: ShareOptions.Style
  let selected: Bool
  let disabled: Bool
  let note: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 6) {
        icon.frame(maxWidth: .infinity, alignment: .leading).frame(height: 34)
          .padding(.horizontal, 7)
          .background(HR.muted, in: RoundedRectangle(cornerRadius: 5))
        Text(style.label).font(HR.popoverFont(12))
        Text(note).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted).lineLimit(1)
      }
      .padding(8).frame(maxWidth: .infinity, alignment: .leading)
      .background(HR.surface, in: RoundedRectangle(cornerRadius: 9))
      .overlay(
        RoundedRectangle(cornerRadius: 9)
          .strokeBorder(selected ? Color.accentColor : HR.border, lineWidth: selected ? 2 : 1)
      )
      .contentShape(Rectangle())
    }.buttonStyle(.plain).disabled(disabled).opacity(disabled ? 0.45 : 1)
      .accessibilityLabel("\(style.label), \(note)")
      .accessibilityAddTraits(selected ? .isSelected : [])
  }

  @ViewBuilder private var icon: some View {
    switch style {
    case .ledger:
      VStack(alignment: .leading, spacing: 3) {
        bar(width: 0.9)
        bar(width: 0.6)
        bar(width: 0.75)
      }
    case .room:
      HStack(alignment: .bottom, spacing: 4) {
        column(18)
        column(8, amber: true)
        column(22)
        column(14)
        column(20)
      }
    case .spotlight:
      VStack(alignment: .leading, spacing: 3) {
        Text("64%").font(HR.popoverFont(13, .semibold))
        Capsule().fill(HR.fill).frame(width: 52, height: 3)
      }
    case .strip:
      HStack(spacing: 5) {
        Text("82%")
        Text("64%")
        Text("9%").foregroundStyle(HR.popoverWarning)
      }.font(.system(size: 9, weight: .semibold)).foregroundStyle(HR.secondary)
    }
  }

  private func bar(width: CGFloat) -> some View {
    GeometryReader { proxy in
      Capsule().fill(HR.fill).frame(width: proxy.size.width * width, height: 3)
    }.frame(height: 3)
  }

  private func column(_ height: CGFloat, amber: Bool = false) -> some View {
    RoundedRectangle(cornerRadius: 1.5).fill(amber ? HR.popoverWarning : HR.fill)
      .frame(width: 6, height: height)
  }
}
