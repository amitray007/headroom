import HeadroomKit
import SwiftUI

extension MenuStatus {
  /// The status for the model's current accounts and preferences.
  @MainActor init(model: AppModel, style: DisplayPreferences.ItemStyle, sample: Bool = false) {
    self.init(
      style: style, preferences: model.preferences, visible: model.accounts,
      all: model.allAccounts, sources: model.sources.map(\.state), ready: model.ready,
      unread: model.unread, now: model.now, sample: sample)
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
      withDot {
        HStack(spacing: 4) {
          LiveGlyph(readings: readings, color: color).frame(width: 16, height: 16)
          if let room = status.liveRoom {
            Text(room.text).font(.system(size: 13, weight: .medium)).monospacedDigit()
              .foregroundStyle(color(room.tone))
          }
        }
      }
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
      MenuRing(left: reading.fill, tone: reading.tone, color: color).frame(width: 14, height: 14)
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
        MenuMeter(fill: reading.fill, tone: reading.tone, color: color).frame(height: 3)
      }
    }.padding(.horizontal, 0.5)
  }
}

/// One row of three dots per slot; lit dots are thirds of the shown figure (room left or used). An out row lights in
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
    guard let fill = reading.fill, fill > 0 else { return 0 }
    return fill < 34 ? 1 : fill < 67 ? 2 : 3
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

/// The colors themselves, in place of a sentence about them: a low ring in yellow and an out
/// ring in red, or both in the plain color when coloring is off.
struct MenuToneLegend: View {
  let colors: Bool
  var body: some View {
    HStack(spacing: 14) {
      sample(left: 14, tone: .low, label: "Low")
      sample(left: 0, tone: .out, label: "Out")
    }
    .font(HR.popoverFont(12, .medium))
    .animation(.easeOut(duration: 0.16), value: colors)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      colors ? "Low shows in yellow, out shows in red" : "Low and out keep the menu bar color")
  }

  private func sample(left: Double, tone: MenuTone, label: String) -> some View {
    HStack(spacing: 5) {
      MenuRing(left: left, tone: tone, color: color).frame(width: 14, height: 14)
      Text(label).foregroundStyle(color(tone))
    }
  }

  private func color(_ tone: MenuTone) -> Color {
    guard colors else { return HR.secondary }
    return tone == .low ? MenuColor.low : HR.danger
  }
}
