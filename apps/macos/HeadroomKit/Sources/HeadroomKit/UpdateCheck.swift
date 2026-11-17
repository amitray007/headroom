import Foundation

/// Finds the newest Mac release among the repository's GitHub releases and compares it with the
/// running version. Pure: it reads a releases JSON body and nothing else.
public enum UpdateCheck {
  public enum Result: Equatable, Sendable {
    case available(version: String, notesURL: URL, publishedAt: Date?)
    case upToDate
  }

  /// Mac releases are tagged `macos-vX.Y.Z`. The server's releases share the repository.
  public static let tagPrefix = "macos-v"
  /// The unauthenticated releases list. Mac tags are never `releases/latest`.
  public static let releasesURL = URL(
    string: "https://api.github.com/repos/amitray007/headroom/releases?per_page=30")!

  private struct Release: Decodable {
    let tag: String
    let pageURL: String
    let draft: Bool?
    let prerelease: Bool?
    let publishedAt: String?

    private enum CodingKeys: String, CodingKey {
      case tag = "tag_name"
      case pageURL = "html_url"
      case draft, prerelease
      case publishedAt = "published_at"
    }
  }

  /// `nil` when the body is not a releases list. A list with no usable Mac release is up to date.
  public static func evaluate(releases body: Data, running: String) -> Result? {
    guard let releases = try? JSONDecoder().decode([Release].self, from: body) else { return nil }
    guard let runningParts = parts(running) else { return nil }
    var newest: (parts: [Int], version: String, url: URL, published: Date?)?
    for release in releases where release.draft != true && release.prerelease != true {
      guard release.tag.hasPrefix(tagPrefix),
        let versionParts = parts(String(release.tag.dropFirst(tagPrefix.count))),
        let url = notesURL(release.pageURL)
      else { continue }
      if let current = newest, compare(versionParts, current.parts) != .orderedDescending {
        continue
      }
      newest = (versionParts, display(versionParts), url, release.publishedAt.flatMap(date))
    }
    guard let newest, compare(newest.parts, runningParts) == .orderedDescending else {
      return .upToDate
    }
    return .available(version: newest.version, notesURL: newest.url, publishedAt: newest.published)
  }

  /// Numeric components of a version. A leading `v` and anything from the first character that
  /// is not a digit or a dot (`-beta.1`, `+5`) are ignored. `nil` when no number is left.
  static func parts(_ version: String) -> [Int]? {
    var text = Substring(version.trimmingCharacters(in: .whitespaces))
    if text.first == "v" || text.first == "V" { text = text.dropFirst() }
    let core = text.prefix { $0.isASCII && ($0.isNumber || $0 == ".") }
    let numbers = core.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
    guard !numbers.isEmpty, numbers.allSatisfy({ $0 != nil }) else { return nil }
    return numbers.compactMap { $0 }
  }

  static func compare(_ left: [Int], _ right: [Int]) -> ComparisonResult {
    for index in 0..<max(left.count, right.count) {
      let a = index < left.count ? left[index] : 0
      let b = index < right.count ? right[index] : 0
      if a != b { return a < b ? .orderedAscending : .orderedDescending }
    }
    return .orderedSame
  }

  private static func display(_ parts: [Int]) -> String {
    parts.map(String.init).joined(separator: ".")
  }

  /// Only a GitHub page on this repository opens from the update card.
  private static func notesURL(_ text: String) -> URL? {
    guard let url = URL(string: text), url.scheme == "https", url.host == "github.com",
      url.path.hasPrefix("/amitray007/headroom/")
    else { return nil }
    return url
  }

  private static func date(_ text: String) -> Date? {
    try? Date(text, strategy: .iso8601)
  }
}

/// How the app starts a Homebrew update, and what it says when that fails.
public enum HomebrewUpdate {
  public static let cask = "amitray007/headroom/headroom-mac"
  public static let arguments = ["upgrade", "--cask", cask]
  public static let command = "brew " + arguments.joined(separator: " ")
  public static let candidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]

  public static func locate(
    isExecutable: (String) -> Bool = {
      FileManager.default.isExecutableFile(atPath: $0)
    }
  ) -> String? {
    candidates.first(where: isExecutable)
  }

  /// One short line for a failed run: the last line brew printed, or the exit status.
  public static func reason(output: String, status: Int32) -> String {
    let line =
      output.split(whereSeparator: \.isNewline)
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .last { !$0.isEmpty }
    guard let line else { return "Homebrew stopped with status \(status)." }
    return line.count > 120 ? String(line.prefix(117)) + "..." : line
  }
}
