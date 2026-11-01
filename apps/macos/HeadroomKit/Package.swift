// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "HeadroomKit",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "HeadroomAPI", targets: ["HeadroomAPI"]),
    .library(name: "HeadroomKit", targets: ["HeadroomKit"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.3"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.3"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.4.0"),
  ],
  targets: [
    .target(
      name: "HeadroomAPI",
      dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")],
      // The generated imports carry @diagnose(UnusedImportAccess, as: ignored), which the
      // Swift 6.4 beta compiler does not honor yet; without this every build prints dozens of
      // warnings about code we do not write. Our own code is in HeadroomKit.
      swiftSettings: [.unsafeFlags(["-suppress-warnings"])],
      plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
    ),
    .target(
      name: "HeadroomKit",
      dependencies: [
        "HeadroomAPI",
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
      ]
    ),
    .testTarget(
      name: "HeadroomKitTests",
      dependencies: ["HeadroomKit", "HeadroomAPI"],
      resources: [.copy("Fixtures")]
    ),
  ],
  swiftLanguageModes: [.v6]
)
