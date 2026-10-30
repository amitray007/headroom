import SwiftUI

/// One motion vocabulary for the app. With Reduce Motion on, movement becomes a short fade.
enum Motion {
  /// Switching between whole views: the account list and the notices.
  static func view(_ reduce: Bool) -> Animation {
    reduce ? .easeOut(duration: 0.15) : .snappy(duration: 0.3)
  }
  /// Opening and closing a row or a notice in place.
  static func expand(_ reduce: Bool) -> Animation {
    reduce ? .easeOut(duration: 0.12) : .snappy(duration: 0.24)
  }
  /// New readings: meters and numbers move to their new value.
  static let data = Animation.smooth(duration: 0.45)
  static let hover = Animation.easeOut(duration: 0.12)

  static func push(_ edge: Edge, _ reduce: Bool) -> AnyTransition {
    reduce ? .opacity : .move(edge: edge).combined(with: .opacity)
  }
  static func reveal(_ reduce: Bool) -> AnyTransition {
    reduce ? .opacity : .opacity.combined(with: .offset(y: -6))
  }
}
