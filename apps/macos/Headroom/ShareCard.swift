import AppKit
import HeadroomKit
import SwiftUI

/// The picture the Share window copies or saves: the card, drawn on an optional backdrop, in
/// a fixed theme. The same view is the live preview and the `ImageRenderer` content, so the
/// preview is the exact image.
struct ShareShot: View {
  let snapshot: ShareSnapshot
  let options: ShareOptions
  /// Worked out by the caller when it needs them too; otherwise measured here.
  var metrics: Metrics?

  /// The size of the card, of the whole picture and the card's scale inside it. Points; the
  /// PNG is drawn at 2x.
  struct Metrics: Equatable {
    var card: CGSize
    var canvas: CGSize
    var scale: CGFloat
  }

  /// A backdrop leaves this much room around the card.
  static let margin: CGFloat = 44

  /// A fixed canvas shrinks a large card into it and grows a small one, up to 1.8x. A card
  /// cannot report its own size to the view around it before the first frame, and
  /// `ImageRenderer` takes only that frame, so the card is measured once in a hosting view.
  @MainActor static func metrics(snapshot: ShareSnapshot, options: ShareOptions) -> Metrics {
    let card = NSHostingController(rootView: ShareCard(snapshot: snapshot, lifted: false))
      .sizeThatFits(in: CGSize(width: 4000, height: 4000))
    let padding = options.backdrop == .none ? 0 : margin * 2
    guard let canvas = options.size.canvas else {
      return Metrics(
        card: card, canvas: CGSize(width: card.width + padding, height: card.height + padding),
        scale: 1)
    }
    let room = CGSize(width: canvas.width - margin * 2, height: canvas.height - margin * 2)
    let scale = max(
      0.1, min(1.8, room.width / max(card.width, 1), room.height / max(card.height, 1)))
    return Metrics(card: card, canvas: canvas, scale: scale)
  }

  var body: some View {
    let metrics = self.metrics ?? Self.metrics(snapshot: snapshot, options: options)
    ZStack {
      ShareBackdrop(backdrop: options.backdrop, size: metrics.canvas)
      ShareCard(snapshot: snapshot, lifted: options.backdrop != .none)
        .scaleEffect(metrics.scale)
    }
    .frame(width: metrics.canvas.width, height: metrics.canvas.height)
    // The whole picture follows the chosen theme, not the app's. The HR colors resolve against
    // this scheme, as the menu bar label's do.
    .environment(\.colorScheme, options.theme == .dark ? .dark : .light)
    .foregroundStyle(HR.ink)
  }
}

/// The backdrop colors, as sRGB from the mockup's oklch values.
enum ShareBackdropColors {
  static let mist = [Color(hex: 0xF0F6FC), Color(hex: 0xD8DFE6)]
  static let ink = [Color(hex: 0x282E38), Color(hex: 0x090B0F)]
}

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
      blue: Double(hex & 255) / 255, opacity: 1)
  }
}

private struct ShareBackdrop: View {
  let backdrop: ShareOptions.Backdrop
  let size: CGSize
  var body: some View {
    switch backdrop {
    case .none:
      Color.clear
    case .mist:
      RadialGradient(
        colors: ShareBackdropColors.mist, center: UnitPoint(x: 0.2, y: 0), startRadius: 0,
        endRadius: max(size.width, size.height) * 1.1)
    case .ink:
      RadialGradient(
        colors: ShareBackdropColors.ink, center: UnitPoint(x: 0.8, y: 0), startRadius: 0,
        endRadius: max(size.width, size.height) * 1.1)
    }
  }
}

// MARK: - Card

/// The card at its own size. `lifted` adds the shadow a backdrop shows.
struct ShareCard: View {
  let snapshot: ShareSnapshot
  let lifted: Bool

  var body: some View {
    Group {
      if snapshot.style == .strip {
        ShareStrip(snapshot: snapshot).modifier(
          ShareChrome(
            radius: 16, insets: EdgeInsets(top: 14, leading: 18, bottom: 14, trailing: 18),
            lifted: lifted))
      } else {
        VStack(alignment: .leading, spacing: 16) {
          ShareHeader(snapshot: snapshot)
          switch snapshot.style {
          case .room: ShareRoom(entries: snapshot.entries)
          case .spotlight: ShareSpotlight(entries: snapshot.entries)
          default: ShareLedger(entries: snapshot.entries)
          }
          ShareFooter(stamp: snapshot.stamp)
        }.modifier(
          ShareChrome(
            radius: 18, insets: EdgeInsets(top: 22, leading: 24, bottom: 18, trailing: 24),
            lifted: lifted))
      }
    }
    .font(HR.popoverFont(13)).monospacedDigit().foregroundStyle(HR.ink).fixedSize()
  }
}

private struct ShareChrome: ViewModifier {
  let radius: CGFloat
  let insets: EdgeInsets
  let lifted: Bool
  func body(content: Content) -> some View {
    content.padding(insets)
      .background(HR.surface, in: RoundedRectangle(cornerRadius: radius))
      .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(HR.border))
      .shadow(color: .black.opacity(lifted ? 0.06 : 0), radius: 1, y: 1)
      .shadow(color: .black.opacity(lifted ? 0.12 : 0), radius: 16, y: 12)
  }
}

extension LedgerRow.Tone {
  /// The text color of a figure at this tone.
  fileprivate var color: Color {
    switch self {
    case .out: HR.popoverDanger
    case .tight: HR.popoverWarning
    case .unknown: HR.secondary
    case .room: HR.ink
    }
  }
}

// MARK: - Header and footer

private struct ShareHeader: View {
  let snapshot: ShareSnapshot

  var body: some View {
    HStack(spacing: 10) {
      title.font(HR.popoverFont(17, .semibold)).lineLimit(1)
      Spacer(minLength: 16)
      tally.font(HR.popoverFont(12)).foregroundStyle(HR.secondary).lineLimit(1)
    }
  }

  @ViewBuilder private var title: some View {
    HStack(spacing: 9) {
      switch snapshot.title {
      case .all(let providers):
        marks(providers)
        Text("All accounts")
      case .provider(let provider):
        ProviderMark(provider: provider).frame(width: 20, height: 20)
        Text(Presentation.providerName(provider))
      case .account(let entry):
        ProviderMark(provider: entry.provider).frame(width: 20, height: 20)
        (Text(entry.providerName + " ").font(HR.popoverFont(17)).foregroundStyle(HR.secondary)
          + Text(entry.name))
      case .some(_, let providers):
        // The tally on the right already counts the accounts.
        marks(providers)
      }
    }
  }

  private func marks(_ providers: [String]) -> some View {
    HStack(spacing: 4) {
      ForEach(providers, id: \.self) { ProviderMark(provider: $0).frame(width: 15, height: 15) }
    }
  }

  /// "9 accounts · 1 out · 1 low", with the out count red and the low count amber.
  private var tally: Text {
    var parts: [Text] = []
    if snapshot.entries.count != 1 { parts.append(Text("\(snapshot.entries.count) accounts")) }
    if snapshot.out > 0 {
      parts.append(Text("\(snapshot.out) out").foregroundStyle(HR.popoverDanger))
    }
    if snapshot.low > 0 {
      parts.append(Text("\(snapshot.low) low").foregroundStyle(HR.popoverWarning))
    }
    guard var line = parts.first else { return Text("") }
    for part in parts.dropFirst() { line = line + Text(" · ") + part }
    return line
  }
}

/// The app's mark on a dark tile, as in the mockup.
private struct ShareGlyph: View {
  let size: CGFloat
  var body: some View {
    RoundedRectangle(cornerRadius: size * 0.27).fill(HR.ink)
      .overlay { HeadroomGlyph().foregroundStyle(HR.surface).padding(size * 0.04) }
      .frame(width: size, height: size)
  }
}

private struct ShareFooter: View {
  let stamp: String?
  var body: some View {
    HStack(spacing: 7) {
      ShareGlyph(size: 16)
      Text("Headroom").font(HR.popoverFont(11, .medium)).foregroundStyle(HR.secondary)
      Spacer(minLength: 12)
      if let stamp { Text(stamp).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted) }
    }.padding(.top, 12).overlay(alignment: .top) { Rectangle().fill(HR.border).frame(height: 1) }
  }
}

// MARK: - Cells

/// Ten cells, one per 10%, filled from the start: left to right, or bottom to top. Out is
/// hatched red, low is amber, the rest grey, as in the popover.
private struct ShareCells: View {
  let fill: Double?
  let tone: LedgerRow.Tone
  var vertical = false
  var gap: CGFloat = 3
  var radius: CGFloat = 2.5
  var body: some View {
    ZStack {
      if tone == .out {
        Hatch().mask(ShareCellShape(fill: 100, vertical: vertical, gap: gap, radius: radius))
          .opacity(0.85)
      } else {
        ShareCellShape(fill: 100, vertical: vertical, gap: gap, radius: radius).fill(HR.track)
        ShareCellShape(fill: fill ?? 0, vertical: vertical, gap: gap, radius: radius).fill(color)
      }
    }
  }
  private var color: Color {
    switch tone {
    case .tight: HR.popoverWarning
    case .unknown: HR.secondary.opacity(0.45)
    default: HR.fill
    }
  }
}

private struct ShareCellShape: Shape {
  let fill: Double
  let vertical: Bool
  let gap: CGFloat
  let radius: CGFloat
  func path(in rect: CGRect) -> Path {
    let length = ((vertical ? rect.height : rect.width) - gap * 9) / 10
    var path = Path()
    for index in 0..<10 {
      let part = CGFloat(min(1, max(0, (fill - Double(index) * 10) / 10)))
      guard part > 0 else { break }
      let start = CGFloat(index) * (length + gap)
      let cell =
        vertical
        ? CGRect(
          x: rect.minX, y: rect.maxY - start - length * part, width: rect.width,
          height: length * part)
        : CGRect(x: rect.minX + start, y: rect.minY, width: length * part, height: rect.height)
      path.addRoundedRect(
        in: cell,
        cornerSize: CGSize(width: min(radius, cell.width / 2), height: min(radius, cell.height / 2))
      )
    }
    return path
  }
}

// MARK: - Ledger

/// The popover as a card: provider groups, every shown limit, extras on the right.
private struct ShareLedger: View {
  let entries: [ShareSnapshot.Entry]

  var body: some View {
    let groups = Self.groups(entries)
    VStack(spacing: 0) {
      ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
        VStack(spacing: 0) {
          ForEach(group) { ShareLedgerRow(entry: $0) }
        }.padding(.vertical, 4)
          .overlay(alignment: .top) {
            if index > 0 { Rectangle().fill(HR.border).frame(height: 1) }
          }
      }
    }.frame(width: 600)
  }

  /// Entries by provider, in the order providers first appear.
  static func groups(_ entries: [ShareSnapshot.Entry]) -> [[ShareSnapshot.Entry]] {
    var order: [String] = []
    var byProvider: [String: [ShareSnapshot.Entry]] = [:]
    for entry in entries {
      if byProvider[entry.provider] == nil { order.append(entry.provider) }
      byProvider[entry.provider, default: []].append(entry)
    }
    return order.compactMap { byProvider[$0] }
  }
}

private struct ShareLedgerRow: View {
  let entry: ShareSnapshot.Entry
  var body: some View {
    HStack(spacing: 16) {
      ShareWho(entry: entry).frame(width: 168, alignment: .leading)
      HStack(spacing: 16) {
        if entry.meters.isEmpty {
          Text("Quota unknown").font(HR.popoverFont(12)).foregroundStyle(HR.textMuted)
          Spacer(minLength: 0)
        }
        ForEach(Array(entry.meters.enumerated()), id: \.offset) { _, meter in
          LedgerMeterView(meter: meter)
        }
      }.frame(maxWidth: .infinity)
      if let extra = entry.extra {
        VStack(alignment: .trailing, spacing: 1) {
          Text(extra.value).font(HR.popoverFont(12.5, .medium))
          Text(extra.label).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
        }.lineLimit(1).minimumScaleFactor(0.85).frame(width: 80, alignment: .trailing)
      }
    }.frame(height: 44)
  }
}

/// The mark, "Provider Name" and a line of plan and email, like the popover row.
private struct ShareWho: View {
  let entry: ShareSnapshot.Entry
  /// A long provider name takes the first line alone; the account name moves below.
  private var nameBelow: Bool { entry.providerName.count > 12 }
  private var subtitle: String? {
    let line = [nameBelow ? entry.name : nil, entry.detail].compactMap { $0 }
      .joined(separator: " · ")
    return line.isEmpty ? nil : line
  }

  var body: some View {
    HStack(spacing: 8) {
      ProviderMark(provider: entry.provider).frame(width: 16, height: 16)
      VStack(alignment: .leading, spacing: 1) {
        if nameBelow {
          Text(entry.providerName).font(HR.popoverFont(13, .medium))
        } else {
          (Text(entry.providerName + " ").foregroundStyle(HR.secondary)
            + Text(entry.name).font(HR.popoverFont(13, .medium)))
            .font(HR.popoverFont(13))
        }
        if let subtitle {
          Text(subtitle).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
        }
      }.lineLimit(1).truncationMode(.tail)
    }
  }
}

// MARK: - Room

/// One vertical column of ten cells per account, at its tightest limit.
private struct ShareRoom: View {
  let entries: [ShareSnapshot.Entry]
  var body: some View {
    HStack(alignment: .bottom, spacing: 14) {
      ForEach(entries) { ShareRoomColumn(entry: $0) }
    }.padding(.top, 6).padding(.horizontal, 4).frame(maxWidth: .infinity)
  }
}

private struct ShareRoomColumn: View {
  let entry: ShareSnapshot.Entry
  private var meter: LedgerRow.Meter? { entry.tightest }
  private var urgent: Bool {
    guard let meter else { return false }
    return meter.tone == .out || meter.runsOut || meter.alarm
  }
  /// The return or run-out time when the limit is urgent, else the window name.
  private var caption: String {
    guard let meter else { return "" }
    if urgent, !meter.note.isEmpty { return meter.note }
    return meter.label.split(separator: ",").first.map(String.init) ?? meter.label
  }

  var body: some View {
    VStack(spacing: 7) {
      Text(meter?.value ?? "—").font(HR.popoverFont(14, .semibold))
        .foregroundStyle(entry.tone.color)
      ShareCells(fill: meter?.fill, tone: entry.tone, vertical: true)
        .frame(width: 30, height: 168)
      VStack(spacing: 3) {
        ProviderMark(provider: entry.provider).frame(width: 16, height: 16)
        Text(entry.shortName).font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
        Text(caption).font(HR.popoverFont(11)).foregroundStyle(
          urgent ? HR.popoverDanger : HR.textMuted)
      }.lineLimit(1).minimumScaleFactor(0.8)
    }.frame(width: 58)
  }
}

// MARK: - Spotlight

/// One to three large figures: the tightest limit of each account, the others listed below.
private struct ShareSpotlight: View {
  let entries: [ShareSnapshot.Entry]
  var body: some View {
    HStack(alignment: .top, spacing: 28) {
      ForEach(entries) { ShareSpot(entry: $0, named: entries.count > 1) }
    }.frame(width: 600)
  }
}

private struct ShareSpot: View {
  let entry: ShareSnapshot.Entry
  /// A lone account is already named in the card's title.
  let named: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if named { ShareWho(entry: entry) }
      if let meter = entry.tightest {
        big(meter)
        ShareCells(fill: meter.fill, tone: entry.tone, gap: 4, radius: 3.5).frame(height: 16)
        let others = entry.meters.filter { $0 != meter }
        if !others.isEmpty {
          VStack(spacing: 5) {
            ForEach(Array(others.enumerated()), id: \.offset) { _, other in
              HStack(spacing: 8) {
                (Text(other.value).font(HR.popoverFont(12, .medium)).foregroundStyle(HR.ink)
                  + Text(" " + other.label))
                Spacer(minLength: 4)
                Text(other.note)
              }.lineLimit(1)
            }
          }.font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
        }
      } else {
        Text("Quota unknown").font(HR.popoverFont(12)).foregroundStyle(HR.textMuted)
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }

  private func big(_ meter: LedgerRow.Meter) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      figure(meter.value).foregroundStyle(entry.tone.color).layoutPriority(1)
      VStack(alignment: .leading, spacing: 1) {
        Text(meter.label).font(HR.popoverFont(13)).foregroundStyle(HR.secondary)
        if !meter.note.isEmpty {
          HStack(spacing: 4) {
            if meter.runsOut { Circle().fill(HR.popoverDanger).frame(width: 6, height: 6) }
            Text(meter.note)
          }.font(HR.popoverFont(12))
            .foregroundStyle(meter.alarm || meter.runsOut ? HR.popoverDanger : HR.textMuted)
        }
      }.lineLimit(2)
    }
  }

  /// A 56 pt number with a small %, or the whole value for an amount.
  @ViewBuilder private func figure(_ value: String) -> some View {
    if value.hasSuffix("%") {
      HStack(alignment: .firstTextBaseline, spacing: 2) {
        Text(String(value.dropLast())).font(HR.popoverFont(56, .semibold)).tracking(-1.96)
        Text("%").font(HR.popoverFont(26, .medium))
      }.lineLimit(1).fixedSize()
    } else {
      Text(value).font(HR.popoverFont(56, .semibold)).tracking(-1.96).lineLimit(1)
        .minimumScaleFactor(0.4)
    }
  }
}

// MARK: - Strip

/// One line: the app's mark, then a big figure per account, then the time.
private struct ShareStrip: View {
  let snapshot: ShareSnapshot
  var body: some View {
    HStack(spacing: 18) {
      ShareGlyph(size: 22)
      divider
      HStack(spacing: 18) {
        ForEach(snapshot.entries) { entry in
          HStack(spacing: 7) {
            ProviderMark(provider: entry.provider).frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: 0) {
              Text(entry.tightest?.value ?? "—").font(HR.popoverFont(19, .semibold))
                .foregroundStyle(entry.tone.color)
              Text(entry.shortName).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
            }
          }
        }
      }
      if let stamp = snapshot.stamp {
        divider
        Text(stamp).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
      }
    }.lineLimit(1)
  }
  private var divider: some View { Rectangle().fill(HR.border).frame(width: 1, height: 30) }
}
