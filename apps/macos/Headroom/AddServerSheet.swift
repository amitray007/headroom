import HeadroomKit
import SwiftUI

/// Add a server: its address, then the browser approves this Mac. No token to copy.
struct AddServerSheet: View {
  let model: AppModel
  var close: () -> Void
  @State private var address = ""
  @State private var session = PairingSession()
  @State private var useToken = false
  @FocusState private var focused: Bool

  var body: some View {
    if useToken {
      SourceEditor(model: model, draft: SourceDraft(url: normalized?.absoluteString ?? address)) {
        close()
      }
    } else {
      pairing
    }
  }

  private var pairing: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Add a server").font(HR.popoverFont(16, .medium)).accessibilityAddTraits(.isHeader)
      switch session.state {
      case .idle, .failed, .denied, .expired, .tooOld:
        WebField(label: "Server address") {
          TextField("home.example.com", text: $address).focused($focused)
            .onSubmit(begin).accessibilityLabel("Server address")
        }
        if let problem { problemLine(problem) }
      case .starting, .waiting, .saving:
        Text("Approve this Mac in your browser.").font(HR.popoverFont(13))
          .foregroundStyle(HR.secondary)
        PairingCodeBox(state: session.state)
      }
      HStack(spacing: 12) {
        Button("Use a token instead") {
          session.cancel()
          useToken = true
        }.buttonStyle(WebButtonStyle(kind: .quiet))
        Spacer()
        Button("Cancel") {
          session.cancel()
          close()
        }.buttonStyle(WebButtonStyle()).keyboardShortcut(.cancelAction)
        if session.active {
          Button("Open it again") { session.openPage() }
            .buttonStyle(WebButtonStyle(kind: .primary)).disabled(!session.waiting)
        } else {
          Button("Continue", action: begin)
            .buttonStyle(WebButtonStyle(kind: .primary)).keyboardShortcut(.defaultAction)
            .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || model.synthetic)
        }
      }.padding(.top, 4)
    }
    .padding(24).frame(width: 440).font(HR.popoverFont(14))
    .foregroundStyle(HR.ink).background(HR.raisedSurface)
    .task { focused = true }
    .onDisappear { session.cancel() }
  }

  private func problemLine(_ text: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(text).font(HR.popoverFont(13)).foregroundStyle(HR.danger)
        .fixedSize(horizontal: false, vertical: true)
      if session.state == .tooOld {
        Link(destination: ServerCompatibility.updateGuide) {
          Label("How to update a server", systemImage: "arrow.up.right").labelStyle(TrailingIcon())
        }.buttonStyle(WebButtonStyle(kind: .quiet, small: true)).padding(.leading, -12)
      }
    }
  }

  private var problem: String? {
    switch session.state {
    case .failed(let message): message
    case .denied: "This Mac was not allowed. Nothing was connected."
    case .expired: "The code expired. Try again."
    case .tooOld: "This server cannot approve in the browser yet. Update it, or use a token."
    default: nil
    }
  }

  /// "home.example.com" means https; a full address keeps its scheme.
  private var normalized: URL? {
    let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    return URL(string: text.contains("://") ? text : "https://\(text)")
  }

  private func begin() {
    guard let url = normalized else { return }
    session.begin(baseURL: url) { token in
      let source = try Source(name: url.host() ?? "Server", baseURL: url)
      try await model.saveSource(
        id: nil, name: source.name, url: source.baseURL.absoluteString, token: token)
      close()
    }
  }
}
