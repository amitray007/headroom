import HeadroomKit
import SwiftUI

/// Ten Forecast cells, one per 10% left. Out is hatched red; low is amber. Drawn as two
/// shapes, not ten stacks of views, and the fill animates as one value.
struct Cells: View {
  let fill: Double?
  let tone: LedgerRow.Tone
  /// The popover animates a changed fill; a widget draws each entry still.
  var animation: Animation? = nil
  var body: some View {
    ZStack {
      if tone == .out {
        Hatch().mask(CellShape(fill: 100))
      } else {
        CellShape(fill: 100).fill(HR.track)
        CellShape(fill: fill ?? 0).fill(color)
      }
    }.frame(height: 7).animation(animation, value: fill)
  }

  private var color: Color {
    switch tone {
    case .tight: HR.popoverWarning
    case .unknown: HR.secondary.opacity(0.45)
    default: HR.fill
    }
  }
}

/// The first `fill` percent of ten rounded cells with 3 pt gaps.
private struct CellShape: Shape {
  var fill: Double
  var animatableData: Double {
    get { fill }
    set { fill = newValue }
  }
  func path(in rect: CGRect) -> Path {
    let gap: CGFloat = 3
    let width = (rect.width - gap * 9) / 10
    var path = Path()
    for index in 0..<10 {
      let part = CGFloat(min(1, max(0, (fill - Double(index) * 10) / 10)))
      guard part > 0 else { break }
      let cell = CGRect(
        x: rect.minX + CGFloat(index) * (width + gap), y: rect.minY, width: width * part,
        height: rect.height)
      path.addRoundedRect(
        in: cell, cornerSize: CGSize(width: min(1.5, cell.width / 2), height: 1.5))
    }
    return path
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
