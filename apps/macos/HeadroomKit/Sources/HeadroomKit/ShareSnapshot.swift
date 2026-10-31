import CoreGraphics
import Foundation

/// How the Share window draws its picture. Kept in the display preferences, so the next share
/// opens with the same look; the account pick is not kept.
public struct ShareOptions: Codable, Equatable, Sendable {
  public enum Style: String, Codable, CaseIterable, Sendable {
    case ledger, room, spotlight, strip
    public var label: String {
      switch self {
      case .ledger: "Ledger"
      case .room: "Room"
      case .spotlight: "Spotlight"
      case .strip: "Strip"
      }
    }
  }
  public enum Size: String, Codable, CaseIterable, Sendable {
    case fit, square, wide
    public var label: String {
      switch self {
      case .fit: "Fit"
      case .square: "Square"
      case .wide: "Wide"
      }
    }
    /// The picture in points; Fit takes the card's own size. The PNG is drawn at 2x.
    public var canvas: CGSize? {
      switch self {
      case .fit: nil
      case .square: CGSize(width: 720, height: 720)
      case .wide: CGSize(width: 960, height: 540)
      }
    }
  }
  public enum Theme: String, Codable, CaseIterable, Sendable { case light, dark }
  /// Which limit each account shows. Tightest shows every limit in Ledger and the one with
  /// least room elsewhere; Session and Weekly show only that window, or every limit when an
  /// account has none of it.
  public enum Window: String, Codable, CaseIterable, Sendable {
    case tightest, session, weekly
    public var label: String {
      switch self {
      case .tightest: "Tightest"
      case .session: "Session"
      case .weekly: "Weekly"
      }
    }
  }
  public enum Backdrop: String, Codable, CaseIterable, Sendable {
    case none, mist, ink
    public var label: String {
      switch self {
      case .none: "None"
      case .mist: "Mist"
      case .ink: "Ink"
      }
    }
  }

  /// Spotlight draws one large figure per account and fits this many side by side.
  public static let spotlightLimit = 3

  public var style: Style = .ledger
  public var size: Size = .fit
  public var theme: Theme = .light
  public var window: Window = .tightest
  public var backdrop: Backdrop = .mist
  /// "Account 1" in place of each account's own name.
  public var hideNames = false
  public var hideEmails = true
  /// Credits, spend and balances drop out; a balance meter shows its percent instead.
  public var hideMoney = false
  public var showTime = true

  public init() {}

  // A file saved before a field existed still loads, with that field at its default.
  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = ShareOptions()
    style = (try? values.decodeIfPresent(Style.self, forKey: .style)) ?? defaults.style
    size = (try? values.decodeIfPresent(Size.self, forKey: .size)) ?? defaults.size
    theme = (try? values.decodeIfPresent(Theme.self, forKey: .theme)) ?? defaults.theme
    window = (try? values.decodeIfPresent(Window.self, forKey: .window)) ?? defaults.window
    backdrop =
      (try? values.decodeIfPresent(Backdrop.self, forKey: .backdrop)) ?? defaults.backdrop
    hideNames = (try? values.decodeIfPresent(Bool.self, forKey: .hideNames)) ?? defaults.hideNames
    hideEmails =
      (try? values.decodeIfPresent(Bool.self, forKey: .hideEmails)) ?? defaults.hideEmails
    hideMoney = (try? values.decodeIfPresent(Bool.self, forKey: .hideMoney)) ?? defaults.hideMoney
    showTime = (try? values.decodeIfPresent(Bool.self, forKey: .showTime)) ?? defaults.showTime
  }

  /// Privacy Mode in the app hides names and money in a share too. Emails are hidden anyway.
  public func applying(privacy: Bool) -> ShareOptions {
    guard privacy else { return self }
    var options = self
    options.hideNames = true
    options.hideEmails = true
    options.hideMoney = true
    return options
  }
}

/// What a shared picture shows, worked out from the popover's rows with the hide choices
/// already applied, so a view only lays it out.
public struct ShareSnapshot: Equatable, Sendable {
  public struct Entry: Equatable, Sendable, Identifiable {
    public let id: String
    /// The provider's raw value, for its mark.
    public let provider: String
    public let providerName: String
    /// The account's name, or "Account 2" when names are hidden.
    public let name: String
    /// Plan, then the email when emails show.
    public let detail: String?
    /// The label under a mark where space is short: the provider name, or the account name
    /// when the picture shows more than one account of that provider or names are hidden.
    public let shortName: String
    public let meters: [LedgerRow.Meter]
    public let extra: LedgerRow.Extra?
    /// The meter with least room: out first, then the smallest fill.
    public let tightest: LedgerRow.Meter?
    public var tone: LedgerRow.Tone { tightest?.tone ?? .unknown }
  }

  public enum Title: Equatable, Sendable {
    /// Every account the popover shows, with each provider once.
    case all(providers: [String])
    case provider(String)
    case account(Entry)
    case some(count: Int, providers: [String])
  }

  public let entries: [Entry]
  public let title: Title
  /// Spotlight with more accounts than fit falls back to Ledger.
  public let style: ShareOptions.Style
  public let out: Int
  public let low: Int
  /// "Sun 1 Nov, 14:20" when the time shows.
  public let stamp: String?

  /// `rows` are the popover's rows in its order, built for `view`; `selected` holds account
  /// keys.
  public init(
    rows: [LedgerRow], selected: Set<String>, options: ShareOptions, now: Date,
    view: DisplayPreferences.LimitsView = .left, timeZone: TimeZone = .current
  ) {
    let picked = rows.filter { selected.contains($0.id) }
    // Numbered by position within the provider among all rows, so "Account 2" stays the same
    // account whichever others are picked.
    var counts: [String: Int] = [:]
    var number: [String: Int] = [:]
    for row in rows {
      let provider = row.item.account.provider.rawValue
      counts[provider, default: 0] += 1
      number[row.id] = counts[provider]
    }
    let pickedPerProvider = Dictionary(
      grouping: picked, by: { $0.item.account.provider.rawValue }
    ).mapValues(\.count)
    entries = picked.map { row in
      let account = row.item.account
      let provider = account.provider.rawValue
      let name = options.hideNames ? "Account \(number[row.id] ?? 1)" : account.name
      let email = options.hideEmails ? nil : account.identity
      let detail = [account.plan, email].compactMap { $0 }.filter { !$0.isEmpty }
        .joined(separator: " · ")
      let meters = Self.pick(row.meters, window: options.window).map {
        options.hideMoney ? Self.withoutMoney($0) : $0
      }
      let extra = row.extra.flatMap { options.hideMoney && $0.isMoney ? nil : $0 }
      return Entry(
        id: row.id, provider: provider, providerName: Presentation.providerName(provider),
        name: name, detail: detail.isEmpty ? nil : detail,
        shortName: (pickedPerProvider[provider] ?? 0) > 1 || options.hideNames
          ? name : Presentation.providerName(provider),
        meters: meters, extra: extra, tightest: Self.tightest(meters, view: view))
    }
    let providers = entries.reduce(into: [String]()) {
      if !$0.contains($1.provider) { $0.append($1.provider) }
    }
    if entries.count == 1, let only = entries.first {
      title = .account(only)
    } else if !entries.isEmpty && entries.count == rows.count {
      title = .all(providers: providers)
    } else if providers.count == 1, let only = providers.first {
      title = .provider(only)
    } else {
      title = .some(count: entries.count, providers: providers)
    }
    style =
      options.style == .spotlight && entries.count > ShareOptions.spotlightLimit
      ? .ledger : options.style
    out = entries.filter { $0.tone == .out }.count
    low = entries.filter { $0.tone == .tight }.count
    stamp =
      options.showTime
      ? Formatting.format(now, pattern: "EEE d MMM, HH:mm", timeZone: timeZone) : nil
  }

  /// "9 accounts · 1 out · 1 low"; one account shows only its out or low.
  public var tally: String {
    var parts = entries.count == 1 ? [] : ["\(entries.count) accounts"]
    if out > 0 { parts.append("\(out) out") }
    if low > 0 { parts.append("\(low) low") }
    return parts.joined(separator: " · ")
  }

  /// The meters in the chosen window. "Weekly" means the longer window, which is monthly for
  /// some providers. An account with no meter in that window keeps all of them.
  static func pick(_ meters: [LedgerRow.Meter], window: ShareOptions.Window) -> [LedgerRow.Meter] {
    let picked =
      switch window {
      case .tightest: meters
      case .session: meters.filter(\.session)
      case .weekly: meters.filter { !$0.session }
      }
    return picked.isEmpty ? meters : picked
  }

  /// A balance meter shows the share of what was bought, not the amount.
  static func withoutMoney(_ meter: LedgerRow.Meter) -> LedgerRow.Meter {
    guard meter.isMoney else { return meter }
    return LedgerRow.Meter(
      fill: meter.fill, value: meter.fill.map { Formatting.barePercent($0) } ?? "Hidden",
      label: meter.label, tone: meter.tone, note: meter.fill == nil ? "" : "of what was bought",
      alarm: meter.alarm, runsOut: meter.runsOut, session: meter.session)
  }

  /// Out first, then low, then the least room. In the used view the fill is the share used.
  static func tightest(_ meters: [LedgerRow.Meter], view: DisplayPreferences.LimitsView)
    -> LedgerRow.Meter?
  {
    func rank(_ tone: LedgerRow.Tone) -> Int {
      switch tone {
      case .out: 0
      case .tight: 1
      case .room: 2
      case .unknown: 3
      }
    }
    func room(_ meter: LedgerRow.Meter) -> Double {
      guard let fill = meter.fill else { return 101 }
      return view == .used ? 100 - fill : fill
    }
    return meters.min { lhs, rhs in
      rank(lhs.tone) != rank(rhs.tone) ? rank(lhs.tone) < rank(rhs.tone) : room(lhs) < room(rhs)
    }
  }
}

extension LedgerRow.Extra {
  /// Spend and balances are money; banked resets are not.
  public var isMoney: Bool { !label.hasPrefix("banked") }
}

extension LedgerRow.Meter {
  /// The balance meter of an account with no quota.
  public var isMoney: Bool { label == "balance" }
}
