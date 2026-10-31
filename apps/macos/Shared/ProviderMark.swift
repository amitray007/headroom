import SwiftUI

struct ProviderMark: View {
  let provider: String
  @Environment(\.colorScheme) private var scheme
  var body: some View {
    Image("provider-\(provider)").resizable().aspectRatio(contentMode: .fit)
      .colorMultiply(
        ["claude", "antigravity"].contains(provider) || scheme == .light ? .white : .clear
      )
      .overlay {
        if scheme == .dark && !["claude", "antigravity"].contains(provider) {
          Image("provider-\(provider)").resizable().aspectRatio(contentMode: .fit).colorInvert()
        }
      }
      .accessibilityHidden(true)
  }
}
