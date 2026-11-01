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
    VStack(alignment: .leading, spacing: 9) {
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
        header
        if let offline {
          Text(
            offline.state == .signedOut
              ? "Sign in again · last readings kept" : "Last readings kept · refresh paused"
          )
          .font(WidgetStyle.font(11)).foregroundStyle(muted).lineLimit(1)
        }
        switch kind {
        case .account:
          if let row = rows.first {
            if row.signIn && row.state != .signedOut {
              Text("Sign in again").font(WidgetStyle.font(11)).foregroundStyle(HR.danger)
            } else if row.state == .connected && stale(row) {
              Text("Stale · last reading kept").font(WidgetStyle.font(11)).foregroundStyle(muted)
            }
            ForEach(row.limits.filter { limitKey == nil || $0.key == limitKey }) { limit in
              limitView(limit)
            }
            if row.limits.isEmpty {
              Text(row.balance ?? "Unknown").font(WidgetStyle.font(12, .semibold))
            }
          }
          Spacer(minLength: 0)
        case .overall: overall
        case .accounts, .allAccounts: accountList
        case .detail: detailList
        }
      }
    }
    .padding(.horizontal, 15).padding(.vertical, 14)
    .font(WidgetStyle.font(12)).foregroundStyle(ink).monospacedDigit()
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(surface)
    .clipShape(RoundedRectangle(cornerRadius: 22))
    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(HR.border, lineWidth: 1))
    .widgetURL(URL(string: "headroom://popover"))
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(
        offline.map { "\($0.name) \($0.state == .signedOut ? "signed out" : "offline")" }
          ?? (kind == .account
            ? rows.first.map { "\(Presentation.providerName($0.provider)) \($0.name)" } : nil)
          ?? kind.title
      )
      // A long account name shrinks a little, then truncates; the age always shows whole.
      .font(WidgetStyle.font(12, .semibold)).lineLimit(1).minimumScaleFactor(0.85)
      if kind == .detail {
        Spacer(minLength: 4)
        Text(countText).font(WidgetStyle.font(11)).foregroundStyle(secondary).lineLimit(1)
      }
      Spacer(minLength: 0)
      Text(age).font(WidgetStyle.font(11)).foregroundStyle(muted).lineLimit(1).fixedSize()
    }.frame(height: 12)
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

  private var accountList: some View {
    let shown = Array(rows.prefix(kind == .accounts ? 3 : 8))
    return VStack(spacing: 0) {
      ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
        accountRow(row)
        if index < shown.count - 1 { Spacer(minLength: offline == nil ? 9 : 5) }
      }
      if kind == .allAccounts && rows.count > 8 {
        Text("+\(rows.count - 8) more").font(WidgetStyle.font(11)).foregroundStyle(muted).frame(
          maxWidth: .infinity, alignment: .leading)
      }
    }.frame(maxHeight: .infinity, alignment: .top)
  }
  private var detailList: some View {
    // Pack by rendered rows, with secondary limits directly below their account.
    let groups = detailColumns
    return HStack(alignment: .top, spacing: 22) {
      ForEach(0..<2) { column in
        VStack(alignment: .leading, spacing: 8) {
          ForEach(groups[column]) { row in
            accountRow(row)
            ForEach(row.limits.filter { !$0.part && $0.key != row.bindingKey }) { limit in
              limitView(limit, showNext: false).padding(.leading, 19)
            }
          }
          Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, alignment: .topLeading)
      }
    }
  }
  private var detailColumns: [[WidgetAccountRow]] {
    var columns: [[WidgetAccountRow]] = [[], []]
    var counts = [0, 0]
    var column = 0
    for row in rows {
      let count = 1 + row.limits.filter { !$0.part && $0.key != row.bindingKey }.count
      if counts[column] + count > 8 && column == 0 { column = 1 }
      guard counts[column] + count <= 8 else { continue }
      columns[column].append(row)
      counts[column] += count
    }
    return columns
  }
  private func stale(_ row: WidgetAccountRow) -> Bool { row.staleAt.map { $0 <= date } ?? true }
  private func binding(_ row: WidgetAccountRow) -> WidgetLimitRow? {
    row.limits.first { $0.key == row.bindingKey } ?? row.limits.first { !$0.part }
  }
  private func value(_ limit: WidgetLimitRow) -> String {
    if limit.unlimited { return "Unlimited" }
    let left = WidgetTimeline.percent(limit, at: date)
    return used
      ? left.map { "\(Formatting.barePercent(100 - $0)) used" } ?? "Unknown"
      : Formatting.percentLeft(left)
  }
  private func tone(_ limit: WidgetLimitRow) -> Color {
    guard let left = WidgetTimeline.percent(limit, at: date) else { return muted }
    if left == 0 { return HR.danger }
    return left <= 20 || limit.runsOutAt != nil ? warning : ink
  }
  private func next(_ row: WidgetAccountRow, limit: WidgetLimitRow?) -> String {
    if row.signIn || row.state == .signedOut {
      return "Sign in again · \(Formatting.age(row.observedAt, now: date))"
    }
    if row.state != .connected {
      return "Kept reading · \(Formatting.age(row.observedAt, now: date))"
    }
    if stale(row) { return "Stale · \(Formatting.age(row.observedAt, now: date))" }
    guard let limit else { return row.balanceLabel ?? "Unknown" }
    return "\(limit.label) · \(WidgetTimeline.next(limit, at: date, timeZone: timeZone))"
  }
  private func accountRow(_ row: WidgetAccountRow) -> some View {
    let limit = binding(row)
    let isQuiet = row.signIn || row.state == .signedOut || stale(row)
    let duplicate = rows.contains {
      $0.id != row.id && $0.provider == row.provider && $0.name == row.name
    }
    let danger =
      row.signIn || row.state == .signedOut
      || (!isQuiet && (limit?.percentLeft == 0 || limit?.runsOutAt != nil))
    return VStack(alignment: .leading, spacing: 5) {
      HStack(spacing: 6) {
        ProviderMark(provider: row.provider).frame(width: 13, height: 13).saturation(quiet ? 0 : 1)
          .opacity(quiet ? 0.65 : 1)
        (Text(Presentation.providerName(row.provider) + " ").foregroundColor(secondary)
          + Text(row.name).font(WidgetStyle.font(12, .semibold))
          + Text(duplicate ? " · \(row.sourceName)" : "").foregroundColor(secondary))
          .lineLimit(1).truncationMode(.tail)
        Spacer(minLength: 0)
        Text(limit.map(value) ?? row.balance ?? "Unknown").font(WidgetStyle.font(12, .semibold))
          .foregroundStyle(isQuiet ? muted : limit.map(tone) ?? ink).fixedSize()
      }.frame(height: 13.2)
      HStack(spacing: 10) {
        if let limit {
          RoomBar(
            left: WidgetTimeline.percent(limit, at: date), unlimited: limit.unlimited,
            quiet: isQuiet, projected: limit.runsOutAt != nil, height: 4
          )
          .frame(minWidth: 60).frame(height: 4)
        } else {
          Spacer(minLength: 0)
        }
        Text(next(row, limit: limit)).font(WidgetStyle.font(11)).foregroundStyle(
          danger ? HR.danger : muted
        ).lineLimit(1)
          .help(
            limit?.runsOutAt == nil
              ? next(row, limit: limit) : next(row, limit: limit) + " if the pace holds"
          )
          .layoutPriority(1)
      }.frame(height: 12.1).padding(.leading, 19)
    }.accessibilityElement(children: .combine)
      .accessibilityValue("\(limit?.interface ?? row.balanceInterface ?? "unknown") interface")
  }
  private func limitView(_ limit: WidgetLimitRow, showNext: Bool = true) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(limit.label).foregroundStyle(secondary).lineLimit(1)
        Spacer(minLength: 4)
        Text(value(limit)).font(WidgetStyle.font(12, .semibold)).foregroundStyle(tone(limit))
          .fixedSize()
      }.frame(height: 13.2)
      RoomBar(
        left: WidgetTimeline.percent(limit, at: date), unlimited: limit.unlimited,
        projected: limit.runsOutAt != nil, height: 4
      ).frame(height: 4)
      if showNext {
        Text(WidgetTimeline.next(limit, at: date, timeZone: timeZone)).font(WidgetStyle.font(11))
          .foregroundStyle(limit.percentLeft == 0 || limit.runsOutAt != nil ? HR.danger : muted)
          .lineLimit(1)
          .frame(height: 12.1)
          .accessibilityLabel(
            WidgetTimeline.next(limit, at: date, timeZone: timeZone)
              + (limit.runsOutAt == nil ? "" : " if the pace holds"))
      }
    }.accessibilityElement(children: .combine)
      .accessibilityValue("\(limit.interface) interface")
  }
  private var counts: [(String, String, Color)] {
    let out = rows.filter { binding($0).map { WidgetTimeline.percent($0, at: date) == 0 } ?? false }
      .count
    let runs = rows.filter { binding($0)?.runsOutAt != nil }.count
    let signIn = rows.filter { $0.signIn || $0.state == .signedOut }.count
    let inventory = rows.compactMap(\.bankedCount).reduce(0, +)
    let inventoryLabel =
      rows.contains { $0.banked != nil && $0.bankedCount == nil }
      ? "Unknown" : String(format: "%.0f", inventory)
    return [
      ("\(out)", "Out now", out > 0 ? HR.danger : muted),
      ("\(runs)", "Runs out", runs > 0 ? warning : muted),
      ("\(signIn)", "Sign in", signIn > 0 ? HR.danger : muted),
      (inventoryLabel, "Banked resets", ink),
    ]
  }
  private var countText: String {
    counts.map { "\($0.0) \($0.1.lowercased())" }.joined(separator: " · ")
  }
  private var overall: some View {
    VStack(alignment: .leading, spacing: 9) {
      LazyVGrid(
        columns: [
          GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading),
        ], alignment: .leading, spacing: 10
      ) {
        ForEach(0..<counts.count, id: \.self) { index in
          let count = counts[index]
          VStack(alignment: .leading, spacing: 3) {
            Text(count.0).font(WidgetStyle.font(22, .semibold)).foregroundStyle(count.2).frame(
              height: 22)
            Text(count.1).font(WidgetStyle.font(11)).foregroundStyle(muted)
              .fixedSize(horizontal: false, vertical: true)
              .frame(height: count.1 == "Banked resets" ? 24.2 : 12.1, alignment: .topLeading)
          }
        }
      }
      let reset = rows.flatMap(\.limits).filter { $0.percentLeft == 0 }.compactMap(\.resetsAt)
        .filter { $0 > date }.min()
      if let reset {
        Text("Next back \(Formatting.when(reset, now: date, timeZone: timeZone))").font(
          WidgetStyle.font(11)
        ).foregroundStyle(muted).frame(height: 12.1)
      }
    }
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
