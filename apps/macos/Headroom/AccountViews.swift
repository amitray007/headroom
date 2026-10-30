import HeadroomAPI
import HeadroomKit
import SwiftUI

/// One provider's rows. Providers are separated by a rule; accounts inside one are not.
struct LedgerGroup: View {
  let rows: [LedgerRow]
  let model: AppModel
  var body: some View {
    VStack(spacing: 0) {
      ForEach(rows) { row in LedgerRowView(row: row, model: model) }
    }.padding(.vertical, 4)
  }
}

struct LedgerRowView: View {
  let row: LedgerRow
  let model: AppModel
  @State private var expanded = false
  @FocusState private var summaryFocused: Bool
  private var item: AccountItem { row.item }
  private var account: FeedAccount { item.account }
  private var quiet: Bool { item.snapshot.state != .connected }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
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
          .background(expanded ? HR.muted : .clear)
      }.buttonStyle(.plain).focused($summaryFocused)
        .accessibilityLabel(row.column.text(now: model.now))
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        .accessibilityHint("Show other limits and account details")
      if expanded { AccountDetail(row: row, model: model).background(HR.muted) }
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

  private var who: some View {
    HStack(spacing: 8) {
      ProviderMark(provider: account.provider.rawValue).frame(width: 16, height: 16)
      VStack(alignment: .leading, spacing: 1) {
        (Text(Presentation.providerName(account.provider.rawValue) + " ")
          .foregroundStyle(HR.secondary)
          + Text(account.name).font(HR.popoverFont(13, .medium)))
          .font(HR.popoverFont(13))
        Text(subtitle).font(HR.popoverFont(11))
          .foregroundStyle(row.column.state == .signIn ? HR.popoverDanger : HR.textMuted)
      }.lineLimit(1).truncationMode(.tail)
    }
  }

  private var subtitle: String {
    if row.column.state == .signIn { return "Sign in again in the dashboard" }
    if quiet {
      return "Kept · \(item.snapshot.source.name) \(item.snapshot.state.label.lowercased())"
    }
    return [
      account.plan, account.identity,
      Presentation.needsSource(item, among: model.accounts) ? item.snapshot.source.name : nil,
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
      Cells(fill: meter.fill, tone: quiet ? .unknown : meter.tone)
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

/// Ten Forecast cells, one per 10% left. Out is hatched red; low is amber.
struct Cells: View {
  let fill: Double?
  let tone: LedgerRow.Tone
  var body: some View {
    HStack(spacing: 3) {
      ForEach(0..<10, id: \.self) { index in
        let part = min(1, max(0, ((fill ?? 0) - Double(index) * 10) / 10))
        ZStack(alignment: .leading) {
          if tone == .out {
            Hatch()
          } else {
            Rectangle().fill(HR.track)
            GeometryReader { geometry in
              Rectangle().fill(color).frame(width: geometry.size.width * part)
            }
          }
        }.clipShape(RoundedRectangle(cornerRadius: 1.5))
      }
    }.frame(height: 7)
  }

  private var color: Color {
    switch tone {
    case .tight: HR.popoverWarning
    case .unknown: HR.secondary.opacity(0.45)
    default: HR.fill
    }
  }
}

struct Hatch: View {
  var body: some View {
    Canvas { context, size in
      for x in stride(from: -size.height, through: size.width, by: 4) {
        var line = Path()
        line.move(to: CGPoint(x: x, y: 0))
        line.addLine(to: CGPoint(x: x + size.height, y: size.height))
        context.stroke(line, with: .color(HR.popoverDanger), lineWidth: 1.2)
      }
    }.clipped()
  }
}

/// Everything the row leaves out: the other limits, every charge, banked resets and a link.
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
            fill: limit.percentLeft,
            tone: limit.percentLeft == nil ? .unknown : limit.percentLeft == 0 ? .out : .room
          )
          Text(limit.unlimited ? "Unlimited" : Formatting.barePercent(limit.percentLeft))
            .font(HR.popoverFont(11.5)).frame(width: 64, alignment: .trailing)
          Text(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now))
            .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
            .frame(width: 96, alignment: .trailing)
        }.lineLimit(1).accessibilityElement(children: .ignore)
          .accessibilityLabel(
            "\(limit.label), \(limit.unlimited ? "Unlimited" : Formatting.percentLeft(limit.percentLeft)), resets \(Formatting.when(Formatting.date(milliseconds: limit.resetsAt), now: model.now)), \(limit.interface.rawValue) interface"
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
      Button("Open dashboard") {
        model.openDashboard(item.snapshot.source, accountID: account.id)
      }.buttonStyle(.plain).underline().font(HR.popoverFont(11)).padding(.vertical, 4)
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
