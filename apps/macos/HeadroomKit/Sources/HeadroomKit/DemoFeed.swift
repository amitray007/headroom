import Foundation

/// The made-up feed behind Demo Mode. Every instant moves by the same amount so the fixture reads
/// as current: its `generatedAt` becomes now, and resets and run-outs keep their distance from it.
public enum DemoFeed {
  static let instantKeys: Set<String> = [
    "at", "expiresAt", "expiries", "generatedAt", "lastSuccessAt", "observedAt", "occurredAt",
    "resetsAt", "runsOutAt",
  ]

  public static func current(_ data: Data, now: Date) throws -> AppFeed {
    let json = try JSONSerialization.jsonObject(with: data)
    guard let generated = (json as? [String: Any])?["generatedAt"] as? NSNumber else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let shift = Int64((now.timeIntervalSince1970 * 1000).rounded()) - generated.int64Value
    let moved = shifted(json, by: shift, instant: false)
    return try JSONDecoder().decode(
      AppFeed.self, from: JSONSerialization.data(withJSONObject: moved))
  }

  private static func shifted(_ value: Any, by shift: Int64, instant: Bool) -> Any {
    if let object = value as? [String: Any] {
      return object.reduce(into: [String: Any]()) { result, entry in
        result[entry.key] = shifted(
          entry.value, by: shift, instant: instantKeys.contains(entry.key))
      }
    }
    if let array = value as? [Any] {
      return array.map { shifted($0, by: shift, instant: instant) }
    }
    if instant, let number = value as? NSNumber {
      return NSNumber(value: number.int64Value + shift)
    }
    return value
  }
}
