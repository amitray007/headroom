import Foundation

public struct WidgetCacheLocation: Sendable {
  public let url: URL

  public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) {
    url = homeDirectory.appending(
      path:
        "Library/Containers/club.theblank.headroom.mac.widgets/Data/Library/Application Support/Headroom/widget-cache.json"
    )
  }

  /// Primary transport: the unsandboxed app writes the extension's own container; the
  /// sandboxed extension resolves Application Support here. If that fails on an owner's
  /// install, the alternative is a read-only home-relative temporary sandbox exception
  /// for the app's cache folder. Change only this type (and that entitlement), never callers.
  public static var ownContainer: WidgetCacheLocation {
    WidgetCacheLocation(url: HeadroomStorage.directory.appending(path: "widget-cache.json"))
  }

  public init(url: URL) { self.url = url }
}

/// All extension reads, including AppEntity queries, use this one cache path.
public struct WidgetCacheReader: Sendable {
  public let location: WidgetCacheLocation
  public init(location: WidgetCacheLocation = .ownContainer) { self.location = location }
  public func read() throws -> WidgetCache? {
    try HeadroomStorage.read(WidgetCache.self, at: location.url)
  }
}
