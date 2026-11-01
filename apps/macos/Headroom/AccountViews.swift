import HeadroomAPI
import HeadroomKit
import SwiftUI

/// An email Privacy Mode blurs until the pointer is over its row. The blur is drawn once into a
/// flat image; a live blur filter is redrawn on every scroll frame.
struct PrivateText: View {
  let text: String
  let hidden: Bool
  var body: some View {
    if hidden {
      Text(text).padding(4).blur(radius: 4).drawingGroup().padding(-4).accessibilityHidden(true)
    } else {
      Text(text)
    }
  }
}

/// One provider's rows. Providers are separated by a rule; accounts inside one are not.
struct LedgerGroup: View {
  let rows: [LedgerRow]
  /// Rows whose subtitle names their source, worked out once for the whole list.
  let withSource: Set<String>
  let focus: FocusState<String?>.Binding
  let model: AppModel
  var body: some View {
    VStack(spacing: 0) {
      // Privacy Mode is passed in, so a change to another preference does not redraw every row.
      let privacy = model.preferences.privacy
      ForEach(rows) { row in
        LedgerRowView(
          row: row, showsSource: withSource.contains(row.id), privacy: privacy,
          siblings: rows.map(\.id), focus: focus, model: model
        )
        .equatable()
      }
    }.padding(.vertical, 4)
  }
}

/// Equatable on what it shows, so a list redraw skips every row whose reading is unchanged.
struct LedgerRowView: View, Equatable {
  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.row.id == rhs.row.id && lhs.showsSource == rhs.showsSource
      && lhs.privacy == rhs.privacy && lhs.siblings == rhs.siblings
      && lhs.row.meters == rhs.row.meters && lhs.row.extra == rhs.row.extra
      && lhs.row.column.state == rhs.row.column.state
      && lhs.row.item.snapshot.state == rhs.row.item.snapshot.state
      && lhs.row.item.snapshot.source.name == rhs.row.item.snapshot.source.name
      && lhs.row.item.account == rhs.row.item.account
  }

  let row: LedgerRow
  let showsSource: Bool
  let privacy: Bool
  /// The keys of the provider's accounts in the list, for "Share All".
  let siblings: [String]
  let focus: FocusState<String?>.Binding
  let model: AppModel
  @State private var expanded = false
  @State private var hovered = false
  private var item: AccountItem { row.item }
  private var account: FeedAccount { item.account }
  private var quiet: Bool { item.snapshot.state != .connected }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // The row opens at once and its detail fades in. Animating the height moved every row
      // below on each frame, and each frame laid out and hit-tested the whole list again.
      Button {
        expanded.toggle()
      } label: {
        HStack(spacing: 14) {
          who.frame(width: 164, alignment: .leading)
          HStack(spacing: 14) {
            if row.meters.isEmpty {
              Text("Quota unknown").font(HR.popoverFont(12)).foregroundStyle(HR.textMuted)
              Spacer(minLength: 0)
            }
            ForEach(Array(row.meters.enumerated()), id: \.offset) { _, meter in
              LedgerMeterView(meter: meter, quiet: quiet || row.column.state == .signIn)
            }
          }.frame(maxWidth: .infinity)
          if let extra = row.extra {
            VStack(alignment: .trailing, spacing: 1) {
              Text(extra.value).font(HR.popoverFont(12.5, .medium))
              Text(extra.label).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
            }.lineLimit(1).fixedSize()
          }
        }.frame(height: 44).padding(.horizontal, 16).contentShape(Rectangle())
          .background(expanded ? HR.muted : hovered ? HR.muted.opacity(0.55) : .clear)
          .animation(Motion.hover, value: hovered)
      }.buttonStyle(.plain).focused(focus, equals: row.id).onHover { hovered = $0 }
        .accessibilityLabel(row.column.text(now: row.now))
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        .accessibilityHint("Show other limits and account details")
      if expanded {
        AccountDetail(row: row, model: model).background(HR.muted).modifier(FadeIn())
      }
    }
    .foregroundStyle(quiet ? HR.secondary : HR.ink)
    .contextMenu {
      Button("Share \(providerName) \(account.name)…") { model.requestShare([row.id]) }
      if siblings.count > 1 {
        Button("Share All \(providerName)…") { model.requestShare(Set(siblings)) }
      }
    }
    .onAppear {
      if model.synthetic && model.captureState == "expanded" && account.id == "claude-max" {
        expanded = true
      }
    }
    .onKeyPress(.escape) {
      guard expanded else { return .ignored }
      expanded = false
      focus.wrappedValue = row.id
      return .handled
    }
  }

  private var who: some View {
    HStack(spacing: 8) {
      ProviderMark(provider: account.provider.rawValue).frame(width: 16, height: 16)
      VStack(alignment: .leading, spacing: 1) {
        if nameBelow {
          Text(providerName).font(HR.popoverFont(13, .medium))
        } else {
          (Text(providerName + " ").foregroundStyle(HR.secondary)
            + Text(account.name).font(HR.popoverFont(13, .medium)))
            .font(HR.popoverFont(13))
        }
        HStack(spacing: 0) {
          Text(subtitle)
          if let identity = shownIdentity {
            Text(subtitle.isEmpty ? "" : " · ")
            PrivateText(text: identity, hidden: hidesIdentity).layoutPriority(-1)
          }
        }.font(HR.popoverFont(11))
          .foregroundStyle(row.column.state == .signIn ? HR.popoverDanger : HR.textMuted)
      }.lineLimit(1).truncationMode(.tail)
    }
  }

  private var providerName: String { Presentation.providerName(account.provider.rawValue) }
  // With no email to tell accounts apart, or a long provider name ("Vercel AI Gateway"), the
  // provider takes the first line and the account name moves to the second.
  private var nameBelow: Bool { account.identity == nil || providerName.count > 12 }

  private var shownIdentity: String? {
    row.column.state == .signIn || quiet ? nil : account.identity
  }
  private var hidesIdentity: Bool { privacy && !hovered && !expanded }

  private var subtitle: String {
    if row.column.state == .signIn { return "Sign in again in the dashboard" }
    if quiet {
      return "Kept · \(item.snapshot.source.name) \(item.snapshot.state.label.lowercased())"
    }
    return [
      nameBelow ? account.name : nil, account.plan,
      showsSource ? item.snapshot.source.name : nil,
    ].compactMap { $0 }.joined(separator: " · ")
  }
}

struct LedgerMeterView: View {
  let meter: LedgerRow.Meter
  var quiet = false
  var body: some View {
    VStack(spacing: 5) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(meter.value).font(HR.popoverFont(13, .medium)).foregroundStyle(tone).fixedSize()
          .contentTransition(.numericText()).animation(Motion.data, value: meter.value)
        // The window name gives way first; the value and the right-edge note stay whole.
        Text(meter.label).font(HR.popoverFont(11.5)).foregroundStyle(HR.textMuted)
          .truncationMode(.tail).layoutPriority(-1)
        Spacer(minLength: 4)
        HStack(spacing: 4) {
          if meter.runsOut { Circle().fill(HR.popoverDanger).frame(width: 6, height: 6) }
          Text(meter.note).font(HR.popoverFont(11))
            .foregroundStyle(meter.alarm && !quiet ? HR.popoverDanger : HR.secondary)
        }.fixedSize()
      }.lineLimit(1)
      Cells(fill: meter.fill, tone: quiet ? .unknown : meter.tone, animation: Motion.data)
    }.frame(maxWidth: .infinity).accessibilityHidden(true)
  }

  private var tone: Color {
    if quiet { return HR.secondary }
    switch meter.tone {
    case .out: return HR.popoverDanger
    case .tight: return HR.popoverWarning
    case .unknown: return HR.secondary
    case .room: return HR.ink
    }
  }
}

/// Everything the row leaves out: the other limits, every charge and banked resets.
struct AccountDetail: View {
  let row: LedgerRow
  let model: AppModel
  private var item: AccountItem { row.item }
  private var account: FeedAccount { item.account }
  private var quiet: Bool { item.snapshot.state != .connected }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text([account.plan, item.snapshot.source.name].compactMap { $0 }.joined(separator: " · "))
        Spacer(minLength: 4)
        Text(
          "Read \(Formatting.age(Formatting.date(milliseconds: account.observedAt), now: model.now))"
        )
      }.font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
      if quiet {
        Text(
          "\(item.snapshot.source.name) is \(item.snapshot.state.label.lowercased()). These are kept readings."
        ).font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
      }
      ForEach(account.limits, id: \.key) { limit in
        HStack(spacing: 12) {
          Text(Presentation.limitLabel(limit, in: account)).font(HR.popoverFont(11.5))
            .frame(width: 120, alignment: .leading)
          Cells(
            fill: Formatting.shown(limit.percentLeft, view: model.preferences.limitsView),
            tone: limit.percentLeft == nil ? .unknown : limit.percentLeft == 0 ? .out : .room,
            animation: Motion.data
          )
          Text(
            limit.unlimited
              ? "Unlimited"
              : Formatting.barePercent(
                Formatting.shown(limit.percentLeft, view: model.preferences.limitsView))
          )
          .font(HR.popoverFont(11.5)).frame(width: 64, alignment: .trailing)
          Text(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now))
            .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
            .frame(width: 96, alignment: .trailing)
        }.lineLimit(1).accessibilityElement(children: .ignore)
          .accessibilityLabel(
            "\(limit.label), \(limit.unlimited ? "Unlimited" : Formatting.share(limit.percentLeft, view: model.preferences.limitsView)), resets \(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now)), \(limit.interface.rawValue) interface"
          )
      }
      ForEach(account.charges, id: \.key) { charge in
        HStack {
          Text(charge.label).foregroundStyle(HR.secondary)
          Spacer()
          Text(Formatting.charge(charge))
        }.font(HR.popoverFont(12)).accessibilityElement(children: .combine)
          .accessibilityHint("\(charge.interface.rawValue) interface")
      }
      if let banked = account.banked {
        HStack {
          Text("Banked resets").foregroundStyle(HR.secondary)
          Spacer()
          Text(banked.count.map { String(format: "%.0f", $0) } ?? "Unknown")
        }.font(HR.popoverFont(12))
        if let date = Formatting.date(milliseconds: banked.expiries.first) {
          Text("First expires \(Formatting.when(date, now: model.now))")
            .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
        }
      }
    }.padding(.leading, 40).padding(.trailing, 16).padding(.top, 4).padding(.bottom, 10)
  }
}

extension SourceState {
  var label: String {
    switch self {
    case .connected: "Connected"
    case .offline: "Offline"
    case .signedOut: "Signed out"
    case .needsUpdate: "Needs update"
    case .noData: "Starting"
    }
  }
}
