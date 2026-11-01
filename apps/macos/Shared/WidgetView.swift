import HeadroomKit
import SwiftUI
import WidgetKit

enum WidgetKind: String, CaseIterable {
  case account, overall, accounts, allAccounts, detail
  var title: String {
    switch self {
    case .account: "Account"
    case .overall: "Overall"
    case .accounts: "Accounts"
    case .allAccounts, .detail: "All accounts"
    }
  }
  var size: CGSize {
    switch self {
    case .account, .overall: CGSize(width: 170, height: 170)
    case .accounts: CGSize(width: 364, height: 170)
    case .allAccounts: CGSize(width: 364, height: 382)
    case .detail: CGSize(width: 744, height: 382)
    }
  }
}

/// Shared with the app's ImageRenderer captures. No network or credential access.
struct HeadroomWidgetView: View {
  let cache: WidgetCache?
  let date: Date
  let kind: WidgetKind
  var accountIDs: [String] = []
  var limitKey: String?
  var used = false
  var dim = false
  var timeZone: TimeZone = .current
  @Environment(\.colorScheme) private var scheme
  @Environment(\.widgetRenderingMode) private var renderingMode

  private var rows: [WidgetAccountRow] {
    let all = cache?.rows ?? []
    switch kind {
    case .account:
      return accountIDs.isEmpty
        ? Array(all.prefix(1)) : accountIDs.prefix(1).compactMap { id in all.first { $0.id == id } }
    case .accounts:
      return accountIDs.isEmpty
        ? Array(all.prefix(3)) : accountIDs.prefix(3).compactMap { id in all.first { $0.id == id } }
    default: return all
    }
  }
  private var quiet: Bool { dim || renderingMode != .fullColor }
  private var secondary: Color { quiet ? HR.color(light: 0x505050, dark: 0xBCBCBC) : HR.secondary }
  private var muted: Color {
    quiet ? HR.color(light: 0x555555, dark: 0xB0B0B0) : HR.color(light: 0x737373, dark: 0x898989)
  }
  private var ink: Color { quiet ? HR.color(light: 0x444444, dark: 0xC1C1C1) : HR.ink }
  private var warning: Color { HR.color(light: 0xAD6500, dark: 0xFFBE2D) }
  private var surface: Color { quiet ? HR.color(light: 0xE1E1E1, dark: 0x202020) : HR.surface }
  private var newest: Date? { rows.compactMap(\.observedAt).max() }
  private var age: String { Formatting.age(newest ?? cache?.writtenAt, now: date) }
  private var offline: WidgetSourceRow? {
    guard let cache, !cache.sources.isEmpty, cache.sources.allSatisfy({ $0.state != .connected })
    else { return nil }
    return cache.sources.first
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if cache == nil {
        empty(art: "loading", title: "No readings yet", message: "Open Headroom to load accounts.")
      } else if cache?.sources.isEmpty == true {
        empty(art: "no-sources", title: "No sources yet", message: "Open Headroom to add a source.")
      } else if rows.isEmpty {
        if cache?.sources.allSatisfy({ $0.state == .noData }) == true {
          empty(
            art: "loading", title: "No readings yet", message: "Open Headroom to read your sources."
          )
        } else if cache?.sources.contains(where: { $0.state != .connected }) == true {
          empty(
            art: "source-offline", title: "No readings yet",
            message: "Open Headroom to check the source.")
        } else {
          empty(
            art: "no-accounts",
            title: cache?.rows.isEmpty == true || accountIDs.isEmpty
              ? "No accounts yet" : "Account unavailable",
            message: "Open the web dashboard to add one.")
        }
      } else {
        switch kind {
        case .account: smallAccount
        case .overall: smallOverall
        case .accounts: medium
        case .allAccounts: large
        case .detail: extraLarge
        }
      }
    }
    .padding(16)
    .font(WidgetStyle.font(12)).foregroundStyle(ink).monospacedDigit()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(surface)
    .clipShape(RoundedRectangle(cornerRadius: 22))
    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(HR.border, lineWidth: 1))
    .widgetURL(URL(string: "headroom://popover"))
  }

  private func empty(art: String, title: String, message: String) -> some View {
    VStack(spacing: 6) {
      artwork(art).frame(width: 76, height: 64).accessibilityHidden(true)
      Text(title).font(WidgetStyle.font(11, .semibold))
      Text(message).font(WidgetStyle.font(11)).foregroundStyle(secondary)
    }.multilineTextAlignment(.center).frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder private func artwork(_ name: String) -> some View {
    if quiet && scheme == .light {
      // The PDF's white surface becomes the dim panel while its original ink stays intact.
      Image(name).resizable().aspectRatio(contentMode: .fit).blendMode(.multiply)
    } else if quiet {
      ink.mask {
        // PDF art has the #181818 surface baked in. Map that luminance to zero alpha.
        Image(name).resizable().contrast(1.104).brightness(-0.052).luminanceToAlpha()
          .aspectRatio(contentMode: .fit)
      }
    } else {
      Image(name).resizable().aspectRatio(contentMode: .fit)
    }
  }

  // MARK: Ledger sizes

  /// Small, one account: the binding limit as a large figure, the session as a cell row below.
  private var smallAccount: some View {
    let row = rows[0]
    let chosen = limitKey.flatMap { key in row.limits.first { $0.key == key } }
    let all = chosen.map { [WidgetLedger.meter($0, at: date, timeZone: timeZone, used: used)] }
      ?? WidgetLedger.meters(row, at: date, timeZone: timeZone, used: used)
    // The longer window leads; a session limit sits below it.
    let big = all.first { !$0.session } ?? all.first
    let rest = all.filter { $0 != big }
    return VStack(alignment: .leading, spacing: 0) {
      who(row, plan: true)
      Spacer(minLength: 6)
      if let big {
        VStack(alignment: .leading, spacing: 5) {
          // The note sits beside the figure when it fits whole, otherwise on its own line.
          ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 8) {
              bigValue(big, row: row)
              VStack(alignment: .leading, spacing: 1) {
                Text(big.label).font(WidgetStyle.font(11.5)).foregroundStyle(muted)
                note(big, row: row)
              }.fixedSize()
            }
            VStack(alignment: .leading, spacing: 2) {
              HStack(alignment: .firstTextBaseline, spacing: 8) {
                bigValue(big, row: row)
                Text(big.label).font(WidgetStyle.font(11.5)).foregroundStyle(muted)
              }
              note(big, row: row)
            }
          }.lineLimit(1)
          cells(big, row: row)
        }
      }
      ForEach(Array(rest.prefix(1).enumerated()), id: \.offset) { _, meter in
        meterView(meter, row: row).padding(.top, 8)
      }
      Spacer(minLength: 6)
      footer(twoLines: true)
    }
    .accessibilityElement(children: .ignore).accessibilityLabel(reading(row, meters: all))
  }

  private func bigValue(_ meter: LedgerRow.Meter, row: WidgetAccountRow) -> some View {
    Text(meter.value).font(WidgetStyle.font(30, .medium)).tracking(-0.6)
      .foregroundStyle(valueColor(meter, row: row)).fixedSize()
  }

  /// Small, every account: the count line over the three accounts that need attention first.
  private var smallOverall: some View {
    let ranked = WidgetLedger.tightest(rows, at: date)
    let shown = Array(ranked.prefix(3))
    let hidden = ranked.dropFirst(3)
    let summary = WidgetLedger.summary(rows, at: date)
    let hiddenLow = WidgetLedger.summary(Array(hidden), at: date)
    return VStack(alignment: .leading, spacing: 8) {
      summaryLine(summary, age: false)
      VStack(alignment: .leading, spacing: 7) {
        ForEach(shown, id: \.id) { row in
          let meter = WidgetLedger.primary(row, at: date, timeZone: timeZone, used: used)
          VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
              mark(row, size: 14)
              Text(meter?.value ?? "Unknown").font(WidgetStyle.font(13, .medium))
                .foregroundStyle(meter.map { valueColor($0, row: row) } ?? secondary)
              Spacer(minLength: 4)
              if let meter { note(meter, row: row) }
            }.lineLimit(1)
            if let meter { cells(meter, row: row) }
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(reading(row, meters: meter.map { [$0] } ?? []))
        }
      }.frame(maxHeight: .infinity)
      if !hidden.isEmpty {
        let low = hiddenLow.out + hiddenLow.runsOut + hiddenLow.low
        Text("\(hidden.count) more, \(low == 0 ? "none" : "\(low)") low")
          .font(WidgetStyle.font(11)).foregroundStyle(muted).lineLimit(1)
      } else {
        footer(twoLines: false)
      }
    }
  }

  /// Medium: up to three chosen accounts, one cell row each, extras pinned right.
  private var medium: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(spacing: 0) {
        ForEach(rows.prefix(3), id: \.id) { row in
          ledgerRow(row, every: false, whoWidth: 128, extraWidth: 52)
            .frame(maxHeight: .infinity)
        }
      }.frame(maxHeight: .infinity)
      footer(twoLines: false).padding(.top, 4)
    }
  }

  /// Large: every account, its ledger row each; "+N more" only when they do not fit.
  private var large: some View {
    let fit = rows.count > 10 ? 9 : rows.count
    return VStack(alignment: .leading, spacing: 0) {
      summaryLine(WidgetLedger.summary(rows, at: date), age: true).padding(.bottom, 8)
      VStack(spacing: 0) {
        ForEach(rows.prefix(fit), id: \.id) { row in
          ledgerRow(row, every: false, whoWidth: 128, extraWidth: 52)
            .frame(maxHeight: .infinity)
        }
      }.frame(maxHeight: .infinity)
      if rows.count > fit {
        Text("+\(rows.count - fit) more").font(WidgetStyle.font(11)).foregroundStyle(muted)
      }
    }
  }

  /// Extra large: two columns, every limit stacked per account, hairlines between accounts.
  private var extraLarge: some View {
    let columns = detailColumns
    let hidden = rows.count - columns[0].count - columns[1].count
    return VStack(alignment: .leading, spacing: 0) {
      summaryLine(WidgetLedger.summary(rows, at: date), age: true).padding(.bottom, 8)
      HStack(alignment: .top, spacing: 20) {
        ForEach(0..<2, id: \.self) { index in
          VStack(spacing: 0) {
            ForEach(Array(columns[index].enumerated()), id: \.element.id) { position, row in
              if position > 0 { Rectangle().fill(hairline).frame(height: 1) }
              ledgerRow(row, every: true, whoWidth: 130, extraWidth: 64)
                .padding(.top, position == 0 ? 0 : 6)
                .padding(.bottom, position == columns[index].count - 1 ? 0 : 6)
                .frame(maxHeight: .infinity)
            }
            if index == 1 && hidden > 0 {
              Text("+\(hidden) more").font(WidgetStyle.font(11)).foregroundStyle(muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
          }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
      }.frame(maxHeight: .infinity)
    }
  }

  /// Fill the left column first, then the right, by meter count; seven meters a column.
  private var detailColumns: [[WidgetAccountRow]] {
    var columns: [[WidgetAccountRow]] = [[], []]
    var counts = [0, 0]
    var column = 0
    for row in rows {
      let count = max(1, WidgetLedger.everyLimit(row).count)
      if counts[column] + count > 7 && column == 0 { column = 1 }
      guard counts[column] + count <= 7 else { continue }
      columns[column].append(row)
      counts[column] += count
    }
    return columns
  }

  // MARK: Ledger parts

  /// One account: who it is, its meters, and the one extra pinned right.
  private func ledgerRow(_ row: WidgetAccountRow, every: Bool, whoWidth: CGFloat, extraWidth: CGFloat)
    -> some View
  {
    // One meter per row, the one that needs attention, except Extra large shows every limit.
    let meters =
      every
      ? WidgetLedger.meters(row, at: date, timeZone: timeZone, used: used, every: true)
      : WidgetLedger.primary(row, at: date, timeZone: timeZone, used: used).map { [$0] } ?? []
    return HStack(alignment: .center, spacing: 10) {
      who(row, plan: true).frame(width: whoWidth, alignment: .leading)
      VStack(spacing: 7) {
        ForEach(Array(meters.enumerated()), id: \.offset) { _, meter in
          meterView(meter, row: row)
        }
        if meters.isEmpty {
          Text("Unknown").font(WidgetStyle.font(13, .medium)).foregroundStyle(secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }.frame(maxWidth: .infinity)
      if let extra = row.extra {
        VStack(alignment: .trailing, spacing: 0) {
          Text(extra.value).font(WidgetStyle.font(12.5, .medium)).minimumScaleFactor(0.8)
          // "banked · Sat" in the popover; the widget keeps the noun.
          Text(extra.label.hasPrefix("banked") ? "banked" : extra.label)
            .font(WidgetStyle.font(11)).foregroundStyle(muted).truncationMode(.tail)
        }.lineLimit(1).frame(maxWidth: extraWidth, alignment: .trailing).fixedSize(
          horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .ignore).accessibilityLabel(reading(row, meters: meters))
  }

  /// The mark, provider faint and account name, with the plan below. The provider word gives
  /// way first when the column is too narrow; the mark still names the provider.
  private func who(_ row: WidgetAccountRow, plan showPlan: Bool) -> some View {
    let duplicate = rows.contains {
      $0.id != row.id && $0.provider == row.provider && $0.name == row.name
    }
    let plan = [row.plan, duplicate ? row.sourceName : nil].compactMap { $0 }
      .joined(separator: " · ")
    return HStack(spacing: 8) {
      mark(row, size: 16)
      VStack(alignment: .leading, spacing: 1) {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 4) {
            Text(Presentation.providerName(row.provider)).foregroundStyle(secondary)
            Text(row.name).font(WidgetStyle.font(12.5, .medium))
          }
          Text(row.name).font(WidgetStyle.font(12.5, .medium)).truncationMode(.tail)
        }
        .font(WidgetStyle.font(12.5)).lineLimit(1)
        if showPlan && !plan.isEmpty {
          Text(plan).font(WidgetStyle.font(11)).foregroundStyle(muted).lineLimit(1)
        }
      }
    }
  }

  private func mark(_ row: WidgetAccountRow, size: CGFloat) -> some View {
    ProviderMark(provider: row.provider).frame(width: size, height: size)
      .saturation(quiet ? 0 : 1).opacity(quiet ? 0.65 : 1)
  }

  /// "70%  weekly            ● out Fri 09:23" over ten cells.
  private func meterView(_ meter: LedgerRow.Meter, row: WidgetAccountRow) -> some View {
    VStack(spacing: 4) {
      // The window name shows whole or not at all; the figure and the note always show.
      ViewThatFits(in: .horizontal) {
        meterLine(meter, row: row, label: true)
        meterLine(meter, row: row, label: false)
      }.lineLimit(1)
      cells(meter, row: row)
    }
  }

  private func meterLine(_ meter: LedgerRow.Meter, row: WidgetAccountRow, label: Bool)
    -> some View
  {
    HStack(alignment: .firstTextBaseline, spacing: 5) {
      Text(meter.value).font(WidgetStyle.font(13, .medium))
        .foregroundStyle(valueColor(meter, row: row)).fixedSize()
      if label {
        Text(meter.label).font(WidgetStyle.font(11.5)).foregroundStyle(muted).fixedSize()
      }
      Spacer(minLength: 6)
      note(meter, row: row).fixedSize()
    }
  }

  @ViewBuilder private func note(_ meter: LedgerRow.Meter, row: WidgetAccountRow) -> some View {
    if row.signIn {
      Text("sign in again").font(WidgetStyle.font(11)).foregroundStyle(HR.popoverDanger)
    } else if !meter.note.isEmpty {
      HStack(spacing: 4) {
        if meter.runsOut && live(row) {
          Circle().fill(HR.popoverDanger).frame(width: 6, height: 6)
        }
        Text(meter.note).font(WidgetStyle.font(11))
          .foregroundStyle(meter.alarm && live(row) ? HR.popoverDanger : secondary)
      }
    }
  }

  private func cells(_ meter: LedgerRow.Meter, row: WidgetAccountRow) -> some View {
    Cells(fill: meter.fill, tone: meter.tone).opacity(live(row) ? 1 : 0.62)
  }

  private func valueColor(_ meter: LedgerRow.Meter, row: WidgetAccountRow) -> Color {
    guard live(row) else { return secondary }
    switch meter.tone {
    case .out: return HR.popoverDanger
    case .tight: return HR.popoverWarning
    case .unknown: return secondary
    case .room: return ink
    }
  }

  /// "1 out  1 runs out  4 banked", with the reading age at the right.
  private func summaryLine(_ summary: WidgetLedger.Summary, age showAge: Bool) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      count(summary.out, "out", alarm: summary.out > 0)
      count(summary.runsOut, "runs out", alarm: summary.runsOut > 0)
      if summary.signIn > 0 { count(summary.signIn, "sign in", alarm: true) }
      if let banked = summary.banked {
        count(banked, "banked", alarm: false)
      } else {
        Text("banked unknown").foregroundStyle(secondary)
      }
      if showAge {
        Spacer(minLength: 4)
        Text(kind == .detail ? ageAndSource : age).foregroundStyle(muted)
      }
    }.font(WidgetStyle.font(11)).lineLimit(1)
  }

  private func count(_ value: Int, _ label: String, alarm: Bool) -> some View {
    (Text("\(value)").font(WidgetStyle.font(11, .medium))
      .foregroundColor(alarm ? HR.popoverDanger : ink)
      + Text(" \(label)").foregroundColor(secondary))
  }

  /// The reading age and source; offline, the source state and the age of the kept reading.
  @ViewBuilder private func footer(twoLines: Bool) -> some View {
    if let offline {
      let state = offline.state == .signedOut ? "signed out" : "offline"
      if twoLines {
        VStack(alignment: .leading, spacing: 1) {
          HStack(spacing: 6) {
            ring
            Text("\(offline.name) \(state)")
          }.foregroundStyle(secondary)
          Text("Last reading, \(oldAge)").foregroundStyle(muted)
        }.font(WidgetStyle.font(11)).lineLimit(1)
      } else {
        HStack(spacing: 6) {
          ring
          Text("\(offline.name) \(state) · last reading, \(oldAge)")
        }.font(WidgetStyle.font(11)).foregroundStyle(secondary).lineLimit(1)
      }
    } else {
      Text(kind == .account ? age : ageAndSource).font(WidgetStyle.font(11))
        .foregroundStyle(muted).lineLimit(1)
    }
  }

  private var ring: some View {
    Circle().strokeBorder(secondary, lineWidth: 1.5).frame(width: 7, height: 7)
  }

  /// "2 h old" for a kept reading.
  private var oldAge: String { age.replacingOccurrences(of: " ago", with: " old") }

  private var ageAndSource: String {
    let sources = cache?.sources ?? []
    let place = sources.count == 1 ? sources[0].name : "\(sources.count) sources"
    return sources.isEmpty ? age : "\(age) · \(place)"
  }

  private var hairline: Color { HR.color(light: 0xE3E3E3, dark: 0x2E2E2E) }

  /// A row reads as current: connected, not stale and signed in.
  private func live(_ row: WidgetAccountRow) -> Bool {
    offline == nil && row.state == .connected && !row.signIn && !stale(row)
  }
  private func stale(_ row: WidgetAccountRow) -> Bool { row.staleAt.map { $0 <= date } ?? true }

  private func reading(_ row: WidgetAccountRow, meters: [LedgerRow.Meter]) -> String {
    let name = "\(Presentation.providerName(row.provider)) \(row.name)"
    let parts = meters.map { meter in
      let value = meter.tone == .unknown ? meter.value : "\(meter.value) \(used ? "used" : "left")"
      let note = meter.runsOut ? "\(meter.note) if the pace holds" : meter.note
      return [meter.label, value, note].filter { !$0.isEmpty }.joined(separator: ", ")
    }
    let extra = row.extra.map { "\($0.value) \($0.label)" }
    return ([name] + parts + [extra].compactMap { $0 }).joined(separator: ". ")
  }
}

private enum WidgetStyle {
  static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    // Static OFL instances of the bundled Geist avoid SwiftUI's variable-face weight drift.
    let face = weight == .semibold ? "Semibold" : weight == .medium ? "Medium" : "Regular"
    return .custom("HeadroomGeist-\(face)", size: max(11, size))
  }
}

/// Accented mode recolors normal SwiftUI text and backgrounds. Preserve the approved
/// dim palette as one full-color image so forecasts stay red and out-of-room hatching
/// stays visible. The widget has one open action; its full reading remains accessible.
struct HeadroomWidgetPresentation: View {
  let cache: WidgetCache?
  let date: Date
  let kind: WidgetKind
  var accountIDs: [String] = []
  var limitKey: String?
  var used = false
  var timeZone: TimeZone = .current
  @Environment(\.widgetRenderingMode) private var mode
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    if mode == .accented {
      GeometryReader { geometry in
        let renderer = ImageRenderer(
          content: content(dim: true)
            .frame(width: geometry.size.width, height: geometry.size.height)
            .environment(\.colorScheme, scheme))
        let _ = renderer.scale = 2
        if let image = renderer.cgImage {
          Image(decorative: image, scale: 2)
            .widgetAccentedRenderingMode(.fullColor)
            .accessibilityLabel(reading)
        } else {
          content(dim: true)
        }
      }
      .widgetURL(URL(string: "headroom://popover"))
    } else {
      content(dim: false)
    }
  }
  private func content(dim: Bool) -> some View {
    HeadroomWidgetView(
      cache: cache, date: date, kind: kind, accountIDs: accountIDs,
      limitKey: limitKey, used: used, dim: dim, timeZone: timeZone)
  }
  private var reading: String {
    let rows = cache?.rows ?? []
    let selected =
      accountIDs.isEmpty ? rows : accountIDs.compactMap { id in rows.first { $0.id == id } }
    if selected.isEmpty {
      return "Headroom. No readings. Open Headroom to check sources and accounts."
    }
    return selected.map { row in
      let limits = row.limits.filter { limitKey == nil || $0.key == limitKey }.map {
        "\($0.label), \(Formatting.percentLeft(WidgetTimeline.percent($0, at: date))), \(WidgetTimeline.next($0, at: date, timeZone: timeZone)), \($0.interface) interface"
      }.joined(separator: ". ")
      return
        "\(Presentation.providerName(row.provider)) \(row.name), \(row.sourceName), \(row.state.rawValue), \(Formatting.age(row.observedAt, now: date)). \(limits) \(row.balance ?? "")"
    }.joined(separator: ". ")
  }
}
