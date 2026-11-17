import Foundation

/// Collects what a `@Sendable` callback reports, for a test to read afterwards.
final class Log<Value: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var items: [Value] = []
  var values: [Value] { lock.withLock { items } }
  @Sendable func add(_ value: Value) { lock.withLock { items.append(value) } }
}
