import SwiftUI

struct ProviderMark: View {
  let provider: String
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    // One image; dark mode inverts the monochrome marks. Claude and Antigravity keep color.
    let image = Image("provider-\(provider)").resizable().aspectRatio(contentMode: .fit)
    Group {
      if scheme == .dark && !["claude", "antigravity"].contains(provider) {
        image.colorInvert()
      } else {
        image
      }
    }.accessibilityHidden(true)
  }
}
