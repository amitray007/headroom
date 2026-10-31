import HeadroomKit
import SwiftUI

/// How much attention one figure in the menu bar needs.
enum MenuTone: Equatable { case plain, low, out }

/// One slot as the menu bar draws it, apart from the account it came from, so Settings can show
/// samples before any account exists.
struct MenuReading: Equatable {
  struct Bar: Equatable {
    var fill: Double?
    var tone: MenuTone
  }
  var name: String
  var provider: String
  /// Room left, 0...100; nil when the feed has no figure.
  var left: Double?
  var tone: MenuTone
  var text: String
  /// Session, then the longer window. Only the bars look reads them.
  var bars: [Bar]
  var look: DisplayPreferences.MenuSlot.Look

  init(column: RoomColumn, look: DisplayPreferences.MenuSlot.Look, now: Date) {
    name = column.item.name
    provider = column.item.account.provider.rawValue
    left = column.percentLeft
    tone = Self.tone(column.state)
    text = Self.text(column, long: false)
    self.look = look
    bars =
      look == .bars
      ? LedgerRow(column: column, now: now).meters.prefix(2).map {
        Bar(fill: $0.fill, tone: $0.tone == .out ? .out : $0.tone == .tight ? .low : .plain)
      } : []
  }

  private init(sample provider: String, left: Double, look: DisplayPreferences.MenuSlot.Look) {
    name = Presentation.providerName(provider)
    self.provider = provider
    self.left = left
    tone = .plain
    text = Formatting.barePercent(left)
    bars = [Bar(fill: min(100, left + 30), tone: .plain), Bar(fill: left, tone: .plain)]
    self.look = look
  }

  /// Settings shows these while no account has a reading.
  static func samples(_ looks: [DisplayPreferences.MenuSlot.Look]) -> [MenuReading] {
    zip([("claude", 62.0), ("codex", 37), ("cursor", 74)], looks).map {
      MenuReading(sample: $0.0.0, left: $0.0.1, look: $0.1)
    }
  }

  static func tone(_ state: RoomColumn.State) -> MenuTone {
    switch state {
    case .out, .signIn: .out
    case .tight: .low
    case .room, .unknown, .kept: .plain
    }
  }

  /// "37%" in a slot, "37% left" beside the logo.
  static func text(_ column: RoomColumn, long: Bool) -> String {
    switch column.state {
    case .signIn: return "!"
    case .out: return "Out"
    case .unknown: return column.item.snapshot.state == .connected ? "Unknown" : "…"
    default:
      return long
        ? Formatting.percentLeft(column.percentLeft) : Formatting.barePercent(column.percentLeft)
    }
  }
}

/// Everything the menu bar item shows, worked out once per redraw.
@MainActor struct MenuStatus {
  let style: DisplayPreferences.ItemStyle
  /// The slots that found an account, in order. Empty for Logo and Logo and room.
  let readings: [MenuReading]
  /// Logo and room: the followed account's room, or what stops it showing.
  let text: String?
  let textTone: MenuTone
  /// Unread notifications (plain) or an account out or signed out outside the slots (out).
  let dot: MenuTone?
  let logos: Bool
  let colors: Bool
  let summary: String

  init(model: AppModel, style: DisplayPreferences.ItemStyle, sample: Bool = false) {
    let preferences = model.preferences
    let now = model.now
    let visible = model.accounts
    self.style = style
    logos = preferences.providerLogos
    colors = preferences.colorLowOut
    let slots: [DisplayPreferences.MenuSlot] =
      switch style {
      case .logo: []
      case .logoAndRoom: Array(preferences.slots.prefix(1))
      case .liveLogo, .dots, .accounts: preferences.slots
      }
    // Chosen accounts first, so a tightest slot never repeats one of them.
    var taken = Set(slots.compactMap(\.account))
    let columns: [RoomColumn?] = slots.map { slot in
      if let id = slot.account {
        return model.allAccounts.first { $0.id == id }.map { RoomColumn(item: $0, now: now) }
      }
      let pick = Self.tightest(visible, excluding: taken, now: now)
      if let pick { taken.insert(pick.id) }
      return pick
    }
    var readings: [MenuReading] = []
    if style.showsSlots {
      for (slot, column) in zip(slots, columns) {
        if let column { readings.append(MenuReading(column: column, look: slot.look, now: now)) }
      }
      if sample && readings.isEmpty { readings = MenuReading.samples(slots.map(\.look)) }
    }
    self.readings = readings

    let shown = Set(columns.compactMap { $0?.id })
    let anyOut = visible.contains { $0.binding?.percentLeft == 0 }
    let needsSignIn = visible.contains {
      $0.snapshot.state == .signedOut || $0.account.state == .reconnect_required
    }
    let problem = visible.contains {
      !shown.contains($0.id)
        && ($0.binding?.percentLeft == 0 || $0.snapshot.state == .signedOut
          || $0.account.state == .reconnect_required)
    }
    dot = problem ? .out : model.unread > 0 ? .plain : nil

    var text: String?
    var textTone = MenuTone.plain
    if style == .logoAndRoom {
      if let column = columns.first ?? nil {
        text = MenuReading.text(column, long: true)
        textTone = MenuReading.tone(column.state)
      } else {
        // Nil when there is nothing to report: no source yet, or sources with no accounts.
        text =
          if needsSignIn {
            "!"
          } else if anyOut {
            "Out"
          } else if model.sources.isEmpty {
            nil
          } else if !model.ready || model.sources.contains(where: { $0.state != .connected }) {
            "…"
          } else {
            visible.isEmpty ? nil : "Unknown"
          }
        textTone = needsSignIn || anyOut ? .out : .plain
      }
      if sample && text == nil { text = Formatting.percentLeft(64) }
    }
    self.text = text
    self.textTone = textTone

    var parts = ["Headroom"]
    if style == .logoAndRoom {
      parts.append((columns.first ?? nil)?.item.name ?? "all accounts")
      parts.append(text ?? "no readings yet")
    } else {
      parts += readings.map {
        "\($0.name), \($0.left != nil && $0.tone != .out ? Formatting.percentLeft($0.left) : $0.text)"
      }
    }
    if model.unread > 0 { parts.append("\(model.unread) unread notifications") }
    summary = parts.joined(separator: ", ")
  }

  /// The connected account with the least room that still has some, ranked by a projected
  /// run-out first. When none has room, an out account, so the slot says so.
  private static func tightest(_ items: [AccountItem], excluding taken: Set<String>, now: Date)
    -> RoomColumn?
  {
    var best: (column: RoomColumn, rank: Double)?
    var out: RoomColumn?
    for item in items where !taken.contains(item.id) && item.snapshot.state == .connected {
      let column = RoomColumn(item: item, now: now)
      if column.state == .out {
        out = out ?? column
        continue
      }
      guard column.hasRoom, let left = column.percentLeft else { continue }
      let rank = column.runsOutAt != nil ? 200 : 100 - left
      if best.map({ rank > $0.rank }) ?? true { best = (column, rank) }
    }
    return best?.column ?? out
  }

  /// True when the label draws in color: a low or out tone, or a provider mark in its own color.
  /// A one-color label is a template image the menu bar tints like any icon.
  var colored: Bool {
    let tones = [textTone, dot ?? .plain] + readings.flatMap { [$0.tone] + $0.bars.map(\.tone) }
    let marks =
      style == .accounts && logos
      && readings.contains { ProviderMark.colored.contains($0.provider) }
    return (colors && tones.contains { $0 != .plain }) || marks
  }
}

/// The menu bar item's content. MenuBarController draws it into an image; Settings shows it live.
struct MenuItemLabel: View {
  let status: MenuStatus

  var body: some View {
    content
      .foregroundStyle(.primary)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(status.summary)
  }

  @ViewBuilder private var content: some View {
    let readings = status.readings
    switch status.style {
    case .liveLogo where !readings.isEmpty:
      withDot { LiveGlyph(readings: readings, color: color).frame(width: 16, height: 16) }
    case .dots where !readings.isEmpty:
      withDot { DotGrid(readings: readings, color: color).frame(width: 16, height: 16) }
    case .accounts where !readings.isEmpty:
      withDot {
        HStack(spacing: 6) {
          ForEach(Array(readings.enumerated()), id: \.offset) { _, reading in
            HStack(spacing: 3) {
              if status.logos {
                ProviderMark(provider: reading.provider).frame(width: 13, height: 13)
              }
              slot(reading)
            }
          }
        }
      }
    default:
      HStack(spacing: 3) {
        glyph
        if status.style == .logoAndRoom, let text = status.text {
          Text(text).font(.system(size: 13, weight: .medium)).monospacedDigit()
            .foregroundStyle(color(status.textTone))
        }
      }
    }
  }

  @ViewBuilder private func slot(_ reading: MenuReading) -> some View {
    switch reading.look {
    case .percent:
      Text(reading.text).font(.system(size: 13, weight: .medium)).monospacedDigit()
        .foregroundStyle(color(reading.tone))
    case .ring:
      MenuRing(left: reading.left, tone: reading.tone, color: color).frame(width: 14, height: 14)
    case .bars:
      MenuBars(bars: reading.bars, color: color).frame(width: 18, height: 10)
    }
  }

  /// The Headroom glyph with the dot in its empty lower corner.
  private var glyph: some View {
    HeadroomGlyph().frame(width: 23, height: 23)
      .overlay(alignment: .bottomTrailing) {
        if let dot = status.dot {
          Circle().fill(color(dot)).frame(width: 5, height: 5).offset(x: -2, y: -2)
        }
      }
      // The glyph's 64 pt grid leaves 12 pt of air left of the bars; the dot ends 2 pt from the
      // right edge. Trim both so the item is as wide as what it draws.
      .padding(.leading, -4).padding(.trailing, -2)
  }

  /// Meters fill their whole icon, so the dot sits after them.
  private func withDot<Meters: View>(@ViewBuilder _ content: () -> Meters) -> some View {
    HStack(spacing: 3) {
      content()
      if let dot = status.dot { Circle().fill(color(dot)).frame(width: 5, height: 5) }
    }
  }

  private func color(_ tone: MenuTone) -> Color {
    guard status.colors else { return .primary }
    return switch tone {
    case .plain: .primary
    case .low: MenuColor.low
    case .out: HR.danger
    }
  }
}

enum MenuColor {
  /// Yellow, darkened on a light menu bar to stay readable.
  static let low = HR.color(light: 0x9A7400, dark: 0xFFD60A)
}

/// The glyph's three bars as live meters, one per slot, top to bottom.
private struct LiveGlyph: View {
  let readings: [MenuReading]
  let color: (MenuTone) -> Color
  var body: some View {
    VStack(spacing: 2.5) {
      ForEach(Array(readings.enumerated()), id: \.offset) { _, reading in
        MenuMeter(fill: reading.left, tone: reading.tone, color: color).frame(height: 3)
      }
    }.padding(.horizontal, 0.5)
  }
}

/// One row of three dots per slot; lit dots are thirds of the room left. An out row lights in
/// red; a row with no figure stays dim.
private struct DotGrid: View {
  let readings: [MenuReading]
  let color: (MenuTone) -> Color
  var body: some View {
    VStack(spacing: 1.6) {
      ForEach(Array(readings.enumerated()), id: \.offset) { _, reading in
        let lit = Self.lit(reading)
        HStack(spacing: 1.6) {
          ForEach(0..<3, id: \.self) { index in
            Circle().fill(color(reading.tone)).frame(width: 3.4, height: 3.4)
              .opacity(index < lit ? 1 : 0.3)
          }
        }
      }
    }
  }
  private static func lit(_ reading: MenuReading) -> Int {
    if reading.tone == .out { return 3 }
    guard let left = reading.left, left > 0 else { return 0 }
    return left < 34 ? 1 : left < 67 ? 2 : 3
  }
}

/// A capsule meter. Out draws a dashed outline in red; no figure draws a dashed outline.
private struct MenuMeter: View {
  let fill: Double?
  let tone: MenuTone
  let color: (MenuTone) -> Color
  var body: some View {
    GeometryReader { geometry in
      if tone == .out || fill == nil {
        Capsule().strokeBorder(
          color(tone).opacity(tone == .out ? 1 : 0.55),
          style: StrokeStyle(lineWidth: 0.7, dash: [1, 1]))
      } else {
        ZStack(alignment: .leading) {
          Capsule().fill(color(tone).opacity(0.28))
          Capsule().fill(color(tone))
            .frame(width: max(geometry.size.height, geometry.size.width * (fill ?? 0) / 100))
        }
      }
    }
  }
}

private struct MenuBars: View {
  let bars: [MenuReading.Bar]
  let color: (MenuTone) -> Color
  var body: some View {
    VStack(spacing: 2) {
      if bars.isEmpty {
        MenuMeter(fill: nil, tone: .plain, color: color).frame(height: 3)
      }
      ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
        MenuMeter(fill: bar.fill, tone: bar.tone, color: color).frame(height: 3)
      }
    }
  }
}

private struct MenuRing: View {
  let left: Double?
  let tone: MenuTone
  let color: (MenuTone) -> Color
  var body: some View {
    ZStack {
      if tone == .out || left == nil {
        Circle().inset(by: 1.5).stroke(
          color(tone).opacity(tone == .out ? 1 : 0.55),
          style: StrokeStyle(lineWidth: 1.4, dash: [1.6, 1.6]))
      } else {
        Circle().inset(by: 1.75).stroke(color(tone).opacity(0.28), lineWidth: 2)
        Circle().inset(by: 1.75).trim(from: 0, to: (left ?? 0) / 100)
          .stroke(color(tone), style: StrokeStyle(lineWidth: 2, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
    }
  }
}
