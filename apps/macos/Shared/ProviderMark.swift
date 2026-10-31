import HeadroomKit
import SwiftUI

struct ProviderMark: View {
  let provider: String
  /// Marks drawn in their own color; the rest draw in one color.
  static let colored = Presentation.coloredMarks
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    // Claude and Antigravity keep their color. The other marks are one color, so they draw as
    // templates in black or white: a tint, not a color filter recomposited on every frame of a
    // scroll.
    let image = Image("provider-\(provider)")
    Group {
      if Self.colored.contains(provider) {
        image.resizable().aspectRatio(contentMode: .fit)
      } else {
        image.renderingMode(.template).resizable().aspectRatio(contentMode: .fit)
          .foregroundStyle(scheme == .dark ? Color.white : Color.black)
      }
    }.accessibilityHidden(true)
  }
}
