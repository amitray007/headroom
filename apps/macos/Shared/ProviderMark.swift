import SwiftUI

struct ProviderMark: View {
  let provider: String
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    // Claude and Antigravity keep their color. The other marks are one color, so they draw as
    // templates in black or white: a tint, not a color filter recomposited on every frame of a
    // scroll.
    let image = Image("provider-\(provider)")
    Group {
      if ["claude", "antigravity"].contains(provider) {
        image.resizable().aspectRatio(contentMode: .fit)
      } else {
        image.renderingMode(.template).resizable().aspectRatio(contentMode: .fit)
          .foregroundStyle(scheme == .dark ? Color.white : Color.black)
      }
    }.accessibilityHidden(true)
  }
}
