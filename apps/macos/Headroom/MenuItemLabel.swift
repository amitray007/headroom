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
        MenuMark(style: status.markStyle, tone: status.mark) {
          HStack(spacing: 4) {
            LiveGlyph(readings: readings).frame(width: 16, height: 16)
            if let room = status.liveRoom {
              Text(room.text).font(.system(size: 13, weight: .medium)).monospacedDigit()
            }
          }
        }
      }
    case .dots where !readings.isEmpty:
      withDot {
        MenuMark(style: status.markStyle, tone: status.mark) {
          DotGrid(readings: readings).frame(width: 16, height: 16)
        }
      }
    case .accounts where !readings.isEmpty:
      withDot {
        HStack(spacing: 6) {
          ForEach(Array(readings.enumerated()), id: \.offset) { index, reading in
            MenuMark(style: status.markStyle, tone: status.slotMarks[index]) {
              HStack(spacing: 3) {
                if status.logos {
                  ProviderMark(
                    provider: reading.provider,
                    monochrome: status.slotMarks[index] != nil && status.markStyle != .stripe
                  )
                  .frame(width: 13, height: 13)
                }
                slot(reading)
              }
            }
          }
        }
      }
    default:
      if status.markStyle == .dot || !status.colors {
        logoContent
      } else {
        withDot {
          MenuMark(style: status.markStyle, tone: status.mark) {
            HStack(spacing: 3) {
              if status.mark != nil && (status.markStyle == .chip || status.markStyle == .inverted)
              {
                // The smaller grid fits an 18 pt chip without the glyph's negative padding.
                HeadroomGlyph().frame(width: 18, height: 18)
              } else {
                glyph
              }
              if status.style == .logoAndRoom, let text = status.text {
                Text(text).font(.system(size: 13, weight: .medium)).monospacedDigit()
              }
            }
          }
        }
      }
    }
  }

  private var logoContent: some View {
    HStack(spacing: 3) {
      glyph
      if status.style == .logoAndRoom, let text = status.text {
        Text(text).font(.system(size: 13, weight: .medium)).monospacedDigit()
      }
    }
  }

  @ViewBuilder private func slot(_ reading: MenuReading) -> some View {
    switch reading.look {
    case .percent:
      Text(reading.text).font(.system(size: 13, weight: .medium)).monospacedDigit()
    case .ring:
      MenuRing(left: reading.fill, tone: reading.tone).frame(width: 14, height: 14)
    case .bars:
      MenuBars(bars: reading.bars).frame(width: 18, height: 10)
    }
  }

  /// The Headroom glyph with the dot in its empty lower corner.
  private var glyph: some View {
    HeadroomGlyph().frame(width: 23, height: 23)
      .overlay(alignment: .bottomTrailing) {
        if let dot = status.dot, status.markStyle == .dot || !status.colors {
          // A ringed dot keeps the plain dot's center.
          let shift = -2 + MenuDot.overhang(status)
          MenuDot(tone: dot, colors: status.colors).offset(x: shift, y: shift)
        }
      }
      // The glyph's 64 pt grid leaves 12 pt of air left of the bars; the dot ends 2 pt from the
      // right edge, or 1 pt with its ring. Trim both so the item is as wide as what it draws.
      .padding(.leading, -4).padding(.trailing, -2 + MenuDot.overhang(status))
  }

  /// Meters fill their whole icon, so the dot sits after them.
  private func withDot<Meters: View>(@ViewBuilder _ content: () -> Meters) -> some View {
    HStack(spacing: 3) {
      content()
      if let dot = status.dot { MenuDot(tone: dot, colors: status.colors) }
    }
  }

}

/// A solid chip owns its contrast. Inverted content cuts through the ink to the menu bar.
private struct MenuMark<Content: View>: View {
  let style: DisplayPreferences.MarkStyle
  let tone: MenuTone?
  @ViewBuilder var content: () -> Content

  var body: some View {
    if let tone {
      switch style {
      case .chip:
        let palette = tone == .out ? MenuPalette.chipOut : MenuPalette.chipLow
        content().foregroundStyle(HR.color(light: palette.ink, dark: palette.ink))
          .padding(.horizontal, 3.5).frame(height: 18)
          .background(
            HR.color(light: palette.fill, dark: palette.fill),
            in: RoundedRectangle(cornerRadius: 6))
      case .inverted:
        content().padding(.horizontal, 3.5).frame(height: 18)
          .blendMode(.destinationOut)
          .background { RoundedRectangle(cornerRadius: 6).fill(.primary) }
          .compositingGroup()
      case .stripe:
        HStack(spacing: 3) {
          Capsule().fill(.primary).frame(width: 2.6, height: 15)
            .overlay { Capsule().fill(MenuColor.fill(tone) ?? .primary).padding(0.65) }
          content()
        }
      case .dot:
        content()
      }
    } else {
      content()
    }
  }
}

/// A ring in the menu bar's ink keeps a colored dot readable over the wallpaper.
struct MenuDot: View {
  let tone: MenuTone
  let colors: Bool
  var body: some View {
    if colors, let fill = MenuColor.fill(tone) {
      // The ring sits inside the frame: the menu bar image ends at the frame, so a stroke
      // past it was cut off.
      Circle().fill(.primary).frame(width: Self.ringed, height: Self.ringed)
        .overlay { Circle().fill(fill).padding(1) }
    } else {
      Circle().fill(.primary).frame(width: 5, height: 5)
    }
  }

  /// A colored dot with its ring; a plain dot is 5 pt.
  static let ringed: CGFloat = 7
  /// How far a ringed dot reaches past a plain one on each side.
  static func overhang(_ status: MenuStatus) -> CGFloat {
    status.colors && status.dot.flatMap(MenuColor.fill) != nil ? (ringed - 5) / 2 : 0
  }
}

enum MenuColor {
  static let low = HR.color(light: MenuPalette.low.light, dark: MenuPalette.low.dark)
  static let out = HR.color(light: MenuPalette.out.light, dark: MenuPalette.out.dark)
  /// The dot's fill; plain has none and draws in ink.
  static func fill(_ tone: MenuTone) -> Color? {
    switch tone {
    case .plain: nil
    case .low: low
    case .out: out
    }
  }
}

/// The glyph's three bars as live meters, one per slot, top to bottom.
private struct LiveGlyph: View {
  let readings: [MenuReading]
  var body: some View {
    VStack(spacing: 2.5) {
      ForEach(Array(readings.enumerated()), id: \.offset) { _, reading in
        MenuMeter(fill: reading.fill, tone: reading.tone).frame(height: 3)
      }
    }.padding(.horizontal, 0.5)
  }
}

/// One row of three dots per slot; lit dots are thirds of the shown figure (room left or used).
/// An out row lights fully; a row with no figure stays dim.
private struct DotGrid: View {
  let readings: [MenuReading]
  var body: some View {
    VStack(spacing: 1.6) {
      ForEach(Array(readings.enumerated()), id: \.offset) { _, reading in
        let lit = Self.lit(reading)
        HStack(spacing: 1.6) {
          ForEach(0..<3, id: \.self) { index in
            Circle().fill(.primary).frame(width: 3.4, height: 3.4)
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

/// A capsule meter in the menu bar's ink. Out draws a dashed outline; no figure draws a dim one.
private struct MenuMeter: View {
  let fill: Double?
  let tone: MenuTone
  var body: some View {
    GeometryReader { geometry in
      if tone == .out || fill == nil {
        Capsule().strokeBorder(
          .primary.opacity(tone == .out ? 1 : 0.55),
          style: StrokeStyle(lineWidth: 0.7, dash: [1, 1]))
      } else {
        ZStack(alignment: .leading) {
          Capsule().fill(.primary.opacity(0.28))
          Capsule().fill(.primary)
            .frame(width: max(geometry.size.height, geometry.size.width * (fill ?? 0) / 100))
        }
      }
    }
  }
}

private struct MenuBars: View {
  let bars: [MenuReading.Bar]
  var body: some View {
    VStack(spacing: 2) {
      if bars.isEmpty {
        MenuMeter(fill: nil, tone: .plain).frame(height: 3)
      }
      ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
        MenuMeter(fill: bar.fill, tone: bar.tone).frame(height: 3)
      }
    }
  }
}

private struct MenuRing: View {
  let left: Double?
  let tone: MenuTone
  var body: some View {
    ZStack {
      if tone == .out || left == nil {
        Circle().inset(by: 1.5).stroke(
          .primary.opacity(tone == .out ? 1 : 0.55),
          style: StrokeStyle(lineWidth: 1.4, dash: [1.6, 1.6]))
      } else {
        Circle().inset(by: 1.75).stroke(.primary.opacity(0.28), lineWidth: 2)
        Circle().inset(by: 1.75).trim(from: 0, to: (left ?? 0) / 100)
          .stroke(.primary, style: StrokeStyle(lineWidth: 2, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
    }
  }
}
