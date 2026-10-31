import HeadroomAPI
import HeadroomKit
import SwiftUI

struct ProviderSection: View {
  let provider: String
  let columns: [RoomColumn]
  let model: AppModel
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 7) {
        ProviderMark(provider: provider).frame(width: 14, height: 14)
        Text(Presentation.providerName(provider)).font(HR.popoverFont(12, .medium))
      }.frame(height: 24).accessibilityAddTraits(.isHeader)
      ForEach(columns) { column in AccountBlock(column: column, model: model) }
    }.padding(.vertical, 8)
  }
}

struct AccountBlock: View {
  let column: RoomColumn
  let model: AppModel
  @State private var expanded = false
  @FocusState private var summaryFocused: Bool
  private var item: AccountItem { column.item }
  private var account: FeedAccount { item.account }
  private var quiet: Bool { item.snapshot.state != .connected }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        expanded.toggle()
      } label: {
        VStack(alignment: .leading, spacing: 0) {
          HStack(spacing: 8) {
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
              .font(.system(size: 9)).foregroundStyle(HR.secondary).frame(width: 8)
            VStack(alignment: .leading, spacing: 0) {
              Text(account.name).font(HR.popoverFont(12)).lineLimit(1)
              Text(subtitle).font(HR.popoverFont(11)).foregroundStyle(HR.secondary).lineLimit(2)
            }.frame(width: 84, alignment: .leading)
            meter(column.limit, signIn: column.state == .signIn)
              .frame(maxWidth: .infinity)
            Text(value).font(HR.popoverFont(12)).foregroundStyle(valueTone)
              .frame(width: 62, alignment: .trailing)
            Text(reset).font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
              .frame(width: 84, alignment: .trailing)
          }.frame(minHeight: 38)
          if let at = column.runsOutAt, !quiet && column.state != .signIn {
            Text(Formatting.runOut(at, now: model.now)).font(HR.popoverFont(11))
              .foregroundStyle(HR.popoverDanger).frame(height: 16, alignment: .leading).padding(
                .leading, 16
              ).padding(.bottom, 5)
          }
        }.padding(.vertical, 3).contentShape(Rectangle())
      }.buttonStyle(.plain).focused($summaryFocused)
        .accessibilityLabel(column.text(now: model.now))
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        .accessibilityHint("Show other limits and account details")
      if expanded { detail }
    }
    .foregroundStyle(quiet ? HR.secondary : HR.ink)
    .onAppear {
      if model.synthetic && model.captureState == "expanded" && account.id == "claude-max" {
        expanded = true
      }
    }
    .onKeyPress(.escape) {
      guard expanded else { return .ignored }
      expanded = false
      summaryFocused = true
      return .handled
    }
  }

  private var subtitle: String {
    let label =
      column.limit.map { Presentation.limitLabel($0, in: account) }
      ?? account.limits.first?.label
      ?? (account.charges.contains { $0.kind == .balance } ? "Balance only" : "Quota unknown")
    if quiet && column.state != .signIn { return "Kept · \(label)" }
    if account.provider == .antigravity { return "Gemini weekly" }
    return label
  }
  private var value: String {
    switch column.state {
    case .signIn: "Sign-in"
    case .out: "Out"
    default: Formatting.barePercent(column.percentLeft)
    }
  }
  private var valueTone: Color {
    if quiet { return HR.secondary }
    switch column.state {
    case .signIn, .out: return HR.popoverDanger
    case .tight: return HR.popoverWarning
    case .unknown, .kept: return HR.secondary
    case .room: return HR.ink
    }
  }
  private var reset: String {
    if column.state == .signIn { return "Unknown" }
    guard let limit = column.limit else { return "" }
    return Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now)
  }

  private func meter(_ limit: FeedAccount.limitsPayloadPayload?, signIn: Bool = false) -> some View
  {
    GeometryReader { geometry in
      if quiet || signIn || limit?.percentLeft == nil {
        Capsule().strokeBorder(
          HR.secondary.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [1, 2]))
        if quiet, !signIn, let left = limit?.percentLeft {
          Capsule().fill(HR.secondary.opacity(0.45))
            .frame(width: geometry.size.width * min(100, max(0, left)) / 100)
        }
      } else if limit?.percentLeft == 0 {
        Hatch().background(HR.popoverDanger.opacity(0.06))
      } else {
        Capsule().fill(HR.track)
        Capsule().fill(
          (limit?.percentLeft ?? 100) <= 20
            || limit.flatMap({ RoomNow.projection($0, now: model.now) }) != nil
            ? HR.popoverWarning : HR.fill
        )
        .frame(width: geometry.size.width * min(100, max(0, limit?.percentLeft ?? 0)) / 100)
      }
    }.frame(height: 5).clipShape(Capsule()).accessibilityHidden(true)
      .opacity(column.limit == nil && account.limits.isEmpty ? 0 : 1)
  }

  private var detail: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(planLine)
        Spacer(minLength: 4)
        Text(
          "Read \(Formatting.age(Formatting.date(milliseconds: account.observedAt), now: model.now))"
        )
      }.font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
      if quiet {
        Text(
          "\(item.snapshot.source.name) is \(item.snapshot.state.label.lowercased()). These are kept readings."
        )
        .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
      }
      ForEach(
        account.limits.filter { $0.key != column.limit?.key || column.state == .signIn }, id: \.key
      ) { limit in
        HStack(spacing: 8) {
          Text(Presentation.limitLabel(limit, in: account)).font(HR.popoverFont(11))
            .frame(width: 84, alignment: .leading)
          meter(limit).frame(maxWidth: .infinity)
          Text(limit.unlimited ? "Unlimited" : Formatting.barePercent(limit.percentLeft))
            .font(HR.popoverFont(11)).frame(width: 62, alignment: .trailing)
          Text(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now))
            .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
            .frame(width: 84, alignment: .trailing)
        }.accessibilityElement(children: .ignore)
          .accessibilityLabel(
            "\(limit.label), \(limit.unlimited ? "Unlimited" : Formatting.percentLeft(limit.percentLeft)), resets \(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now)), \(limit.interface.rawValue) interface"
          )
      }
      if account.provider == .antigravity
        && account.limits.contains(where: { $0.percentLeft == nil })
      {
        Text("Other limits unknown").font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
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
            .font(HR.popoverFont(11)).foregroundStyle(HR.secondary).padding(.vertical, 4)
        }
      }
      if column.state == .signIn {
        Text(
          "Last reading: \(Formatting.percentLeft(column.percentLeft)). Sign-in is managed in the dashboard."
        )
        .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
      }
      Button("Open dashboard") {
        model.openDashboard(item.snapshot.source, accountID: account.id)
      }.buttonStyle(.plain).underline().font(HR.popoverFont(11)).padding(.vertical, 5)
    }.padding(.leading, 16).padding(.top, 10).padding(.bottom, 4)
  }

  private var planLine: String {
    let sourceMatters =
      Presentation.needsSource(item, among: model.accounts)
      || model.accounts.contains {
        $0.id != item.id && $0.account.provider == account.provider
          && $0.account.name == account.name && $0.snapshot.id != item.snapshot.id
      }
    return [account.plan, sourceMatters ? item.snapshot.source.name : nil].compactMap { $0 }.joined(
      separator: " · ")
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
