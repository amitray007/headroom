import SwiftUI

/// One motion vocabulary for the app: short, critically damped curves with no bounce, so motion
/// confirms a change without drawing the eye. With Reduce Motion on, movement becomes a fade.
enum Motion {
  /// Switching between whole views: the account list and the notices.
  static func view(_ reduce: Bool) -> Animation {
    reduce ? .easeOut(duration: 0.12) : .smooth(duration: 0.2)
  }
  /// Opening and closing a row or a notice in place.
  static func expand(_ reduce: Bool) -> Animation {
    reduce ? .easeOut(duration: 0.1) : .smooth(duration: 0.18)
  }
  /// New readings: meters and numbers move to their new value.
  static let data = Animation.smooth(duration: 0.3)
  static let hover = Animation.easeOut(duration: 0.1)
  /// A button press: in quickly, out without a spring.
  static func press(_ pressed: Bool) -> Animation {
    pressed ? .easeOut(duration: 0.08) : .easeOut(duration: 0.14)
  }

  static func reveal(_ reduce: Bool) -> AnyTransition {
    reduce ? .opacity : .opacity.combined(with: .offset(y: -3))
  }
}

/// Fades a newly shown part in without moving anything around it. Only opacity animates, so
/// nothing is laid out again during the fade.
struct FadeIn: ViewModifier {
  @State private var shown = false
  func body(content: Content) -> some View {
    content.opacity(shown ? 1 : 0)
      .onAppear { withAnimation(Motion.hover) { shown = true } }
  }
}
