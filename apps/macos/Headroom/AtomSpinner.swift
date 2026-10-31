import SwiftUI

/// Three rings tumbling inside a circle, after the Atom spinner from loading.dev (MIT, Jakub
/// Krehel). Each ring is a circle turning about an axis in the screen plane, so it projects to
/// an ellipse whose width follows the cosine of its turn. The rings sit 60° apart and a third
/// of a turn out of phase. Drawn on one canvas that only ticks while it is shown.
struct AtomSpinner: View {
  var size: CGFloat = 16
  /// One full turn of a ring.
  var period: Double = 1
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(paused: reduceMotion)) { timeline in
      let phase = timeline.date.timeIntervalSinceReferenceDate / period
      Canvas { context, canvas in
        let center = CGPoint(x: canvas.width / 2, y: canvas.height / 2)
        let shell = size * 0.055
        let ring = size * 0.045
        let outer = size / 2
        context.stroke(
          Path(
            ellipseIn: CGRect(
              x: center.x - outer + shell / 2, y: center.y - outer + shell / 2,
              width: size - shell, height: size - shell)),
          with: .foreground, lineWidth: shell)
        let radius = outer - ring / 2
        for index in 0..<3 {
          // Reduce Motion holds each ring at a fixed angle instead of turning it.
          let turn = reduceMotion ? 1 / 6 : phase + Double(index) / 3
          let width = radius * abs(cos(turn * 2 * .pi))
          let ellipse = Path(
            ellipseIn: CGRect(x: -width, y: -radius, width: width * 2, height: radius * 2))
          let tilt = CGAffineTransform(rotationAngle: CGFloat(index) * .pi / 3)
            .concatenating(CGAffineTransform(translationX: center.x, y: center.y))
          context.stroke(ellipse.applying(tilt), with: .foreground, lineWidth: ring)
        }
      }
    }.frame(width: size, height: size).accessibilityHidden(true)
  }
}
