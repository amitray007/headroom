import Foundation

/// Which Headroom servers this build reads, and where an owner learns to update one.
///
/// The app never refuses a server by its version number: a server built from `main` reports the
/// last release while it already has newer endpoints. It decides from what the server answers
/// (a missing endpoint, a missing field, a value it does not know) and uses the versions only to
/// say which side to update. See docs/architecture/mac-app.md#server-compatibility.
public enum ServerCompatibility {
  /// The oldest server release this build reads: 0.1.15 added the Mac app API, read sync and
  /// Refresh Every. Raise it in the change that makes the app depend on a newer endpoint or a
  /// newly required field, to the first server release that has it.
  public static let minimumServer = "0.1.15"

  /// The Update table in the install guide. The app cannot tell how a server was installed.
  public static let updateGuide = URL(
    string: "https://github.com/amitray007/headroom/blob/main/docs/operations/install.md#update")!

  /// A server that cannot be read: which side to update. A missing field means the server is
  /// older than this build expects; a value or type this build does not know means it is newer.
  static func side(of error: DecodingError) -> SourceState {
    switch error {
    case .keyNotFound, .valueNotFound: .needsUpdate
    default: .appOutdated
    }
  }
}
