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
