import AppKit
import CoreText
import SwiftUI

// Round 5's neutral tokens, expressed in sRGB for native rendering.
enum HR {
  static let surface = color(light: 0xFFFFFF, dark: 0x181818)
  static let background = color(light: 0xFAFAFA, dark: 0x121212)
  static let raised = color(light: 0xFFFFFF, dark: 0x1F1F1F)
  static let muted = color(light: 0xF5F5F5, dark: 0x242424)
  static let border = color(light: 0xE4E4E4, dark: 0x2D2D2D)
  static let ink = color(light: 0x0D0D0D, dark: 0xF2F2F2)
  static let secondary = color(light: 0x595959, dark: 0xAEAEAE)
  static let warning = color(light: 0x875000, dark: 0xFFBE2D)
  static let danger = color(light: 0xD20D2D, dark: 0xFF686B)
  static let track = color(light: 0xE9E9E9, dark: 0x292929)
  static let fill = color(light: 0x606060, dark: 0x969696)
  // The popover's and widgets' low and out colors, shared so the ledger cells match.
  static let popoverWarning = color(light: 0x8A4C00, dark: 0xF1CD7E)
  static let popoverDanger = color(light: 0xCD1526, dark: 0xFF746E)

  static func color(light: UInt32, dark: UInt32) -> Color {
    Color(
      nsColor: NSColor(name: nil) { appearance in
        let value = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        return NSColor(
          srgbRed: Double((value >> 16) & 255) / 255,
          green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, alpha: 1)
      })
  }
  static func font(_ size: CGFloat = 13, _ weight: Font.Weight = .regular) -> Font {
    .custom("Geist-Regular", size: max(11, size)).weight(weight)
  }
  static func registerFonts() {
    for name in [
      "Geist", "HeadroomGeist-Regular", "HeadroomGeist-Medium", "HeadroomGeist-Semibold",
    ] {
      if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
      }
    }
  }
}

struct HeadroomGlyph: View {
  var body: some View {
    GeometryReader { geometry in
      let scale = geometry.size.width / 64
      ZStack(alignment: .topLeading) {
        RoundedRectangle(cornerRadius: 2 * scale).fill(.primary.opacity(0.55))
          .frame(width: 40 * scale, height: 4 * scale).offset(x: 12 * scale, y: 16 * scale)
        RoundedRectangle(cornerRadius: 4 * scale).fill(.primary)
          .frame(width: 28 * scale, height: 8 * scale).offset(x: 12 * scale, y: 28 * scale)
        RoundedRectangle(cornerRadius: 4 * scale).fill(.primary)
          .frame(width: 16 * scale, height: 8 * scale).offset(x: 12 * scale, y: 40 * scale)
      }
    }.aspectRatio(1, contentMode: .fit).accessibilityHidden(true)
  }
}

struct HRButtonStyle: ButtonStyle {
  var selected = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .padding(.horizontal, 10).padding(.vertical, 6)
      .foregroundStyle(selected ? HR.surface : HR.ink)
      .background(
        selected ? HR.ink : configuration.isPressed ? HR.track : HR.raised,
        in: RoundedRectangle(cornerRadius: 7)
      )
      .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(HR.border, lineWidth: 1))
      .contentShape(RoundedRectangle(cornerRadius: 7))
  }
}

struct ToolButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.frame(minWidth: 24, minHeight: 24)
      .background(
        configuration.isPressed ? HR.track : .clear,
        in: RoundedRectangle(cornerRadius: 5)
      ).contentShape(Rectangle())
  }
}

struct ArtState: View {
  let art: String
  let title: String
  let message: String
  var compact = false
  var body: some View {
    VStack(spacing: 10) {
      Image(art).resizable().aspectRatio(contentMode: .fit)
        .frame(width: compact ? 56 : 100, height: compact ? 56 : 100)
        .accessibilityHidden(true)
      Text(title).font(HR.font(16, .semibold)).accessibilityAddTraits(.isHeader)
      if !message.isEmpty { Text(message).font(HR.font(13)).foregroundStyle(HR.secondary) }
    }
    .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 20)
    .padding(.horizontal, 24)
  }
}

struct RoomBar: View {
  let left: Double?
  var unlimited = false
  var quiet = false
  var projected = false
  var height: CGFloat = 5
  var body: some View {
    GeometryReader { geometry in
      if left == nil && !unlimited {
        RoundedRectangle(cornerRadius: 3).strokeBorder(
          HR.secondary,
          style: StrokeStyle(lineWidth: 1, dash: [1, 3]))
      } else if left == 0 && !unlimited {
        Canvas { context, size in
          context.fill(
            Path(CGRect(origin: .zero, size: size)), with: .color(HR.danger.opacity(0.10)))
          for x in stride(from: -6.0, through: size.width + 6, by: 5) {
            var path = Path()
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x + 5, y: size.height))
            context.stroke(path, with: .color(HR.danger.opacity(0.6)), lineWidth: 1.2)
          }
        }
      } else {
        Capsule().fill(HR.track)
        Capsule().fill(
          quiet ? HR.secondary : (left ?? 100) <= 20 || projected ? HR.warning : HR.fill
        )
        .frame(width: geometry.size.width * CGFloat(min(100, max(0, left ?? 100))) / 100)
      }
    }
    .frame(height: height).clipShape(Capsule()).accessibilityHidden(true)
  }
}

extension View {
  func hrHeading() -> some View {
    self.font(HR.font(13, .semibold)).accessibilityAddTraits(.isHeader)
  }
}
