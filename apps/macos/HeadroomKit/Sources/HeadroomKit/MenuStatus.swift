import Foundation

/// How much attention one figure in the menu bar needs.
public enum MenuTone: Equatable, Sendable {
  case plain, low, out
  /// Out outranks low, and low outranks plain.
  var rank: Int {
    switch self {
    case .plain: 0
    case .low: 1
    case .out: 2
    }
  }
}

/// Ringed dots and stripes use appearance-specific colors against the menu bar's ink.
/// Chips provide their own solid background and contrasting content.
public enum MenuPalette {
  public struct Pair: Sendable {
    public let light: UInt32
    public let dark: UInt32
  }
  public static let low = Pair(light: 0xFFD60A, dark: 0xA87B00)
  public static let out = Pair(light: 0xFF3B30, dark: 0xE0201B)
  public static let chipLow = (fill: UInt32(0xFFD60A), ink: UInt32(0x000000))
  public static let chipOut = (fill: UInt32(0xD70015), ink: UInt32(0xFFFFFF))
  /// What macOS draws menu bar text in: black on a light menu bar, white on a dark one.
  public static let ink = Pair(light: 0x000000, dark: 0xFFFFFF)

  /// The WCAG contrast ratio of two sRGB colors, 1...21.
  public static func contrast(_ a: UInt32, _ b: UInt32) -> Double {
    // Typed steps: one chained expression timed out the type checker on CI's Swift.
    func channel(_ color: UInt32, _ shift: UInt32) -> Double {
      let value = Double((color >> shift) & 255) / 255
      return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    func luminance(_ color: UInt32) -> Double {
      let red = channel(color, 16)
      let green = channel(color, 8)
      let blue = channel(color, 0)
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    let (x, y) = (luminance(a), luminance(b))
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)
  }
}

/// One slot as the menu bar draws it, apart from the account it came from, so Settings can show
/// samples before any account exists.
public struct MenuReading: Equatable, Sendable {
  public struct Bar: Equatable, Sendable {
    public var fill: Double?
    public var tone: MenuTone
  }
  public var name: String
  public var provider: String
  /// Room left, 0...100; nil when the feed has no figure. Ranks the slots.
  public var left: Double?
  /// What the meters fill to: room left, or the share used, by the owner's view.
  public var fill: Double?
  public var tone: MenuTone
  public var text: String
  /// Session, then the longer window. Only the bars look reads them.
  public var bars: [Bar]
  public var look: DisplayPreferences.MenuSlot.Look

  public init(
    column: RoomColumn, look: DisplayPreferences.MenuSlot.Look, now: Date,
    view: DisplayPreferences.LimitsView
  ) {
    name = column.item.name
    provider = column.item.account.provider.rawValue
    left = column.percentLeft
    fill = Formatting.shown(column.percentLeft, view: view)
    tone = Self.tone(column.state)
    text = Self.text(column, long: false, view: view)
    self.look = look
    bars =
      look == .bars
      ? LedgerRow(column: column, now: now, view: view).meters.prefix(2).map {
        Bar(fill: $0.fill, tone: $0.tone == .out ? .out : $0.tone == .tight ? .low : .plain)
      } : []
  }

  private init(
    sample provider: String, left: Double, look: DisplayPreferences.MenuSlot.Look,
    view: DisplayPreferences.LimitsView
  ) {
    name = Presentation.providerName(provider)
    self.provider = provider
    self.left = left
    let shown = Formatting.shown(left, view: view) ?? left
    fill = shown
    tone = .plain
    text = Formatting.barePercent(shown)
    let session = Formatting.shown(min(100, left + 30), view: view)
    bars = [Bar(fill: session, tone: .plain), Bar(fill: shown, tone: .plain)]
    self.look = look
  }

  /// Settings shows these while no account has a reading.
  public static func samples(
    _ looks: [DisplayPreferences.MenuSlot.Look], view: DisplayPreferences.LimitsView
  ) -> [MenuReading] {
    zip([("claude", 62.0), ("codex", 37), ("cursor", 74)], looks).map {
      MenuReading(sample: $0.0.0, left: $0.0.1, look: $0.1, view: view)
    }
  }

  /// Include session bars when deciding which mark an account needs.
  public var loudestTone: MenuTone {
    ([tone] + bars.map(\.tone)).max { $0.rank < $1.rank } ?? .plain
  }

  public static func tone(_ state: RoomColumn.State) -> MenuTone {
    switch state {
    case .out, .signIn: .out
    case .tight: .low
    case .room, .unknown, .kept: .plain
    }
  }

  /// "37%" in a slot, "37% left" (or "63% used") beside the logo.
  public static func text(
    _ column: RoomColumn, long: Bool, view: DisplayPreferences.LimitsView
  ) -> String {
    switch column.state {
    case .signIn: return "!"
    case .out: return "Out"
    case .unknown: return column.item.snapshot.state == .connected ? "Unknown" : "…"
    default:
      return long
        ? Formatting.share(column.percentLeft, view: view)
        : Formatting.barePercent(Formatting.shown(column.percentLeft, view: view))
    }
  }
}

/// Everything the menu bar item shows, worked out once per redraw.
/// Equatable, so the menu bar skips drawing a label it already shows.
public struct MenuStatus: Equatable, Sendable {
  public let style: DisplayPreferences.ItemStyle
  /// The slots that found an account, in order. Empty for Logo and Logo and room.
  public let readings: [MenuReading]
  /// Logo and room: the followed account's room, or what stops it showing.
  public let text: String?
  public let textTone: MenuTone
  /// Out when an account outside the slots is out or signed out; with color on, the most
  /// urgent tone the label shows; otherwise plain for unread notifications.
  public let dot: MenuTone?
  public let logos: Bool
  public let colors: Bool
  public let markStyle: DisplayPreferences.MarkStyle
  /// Non-Dot styles mark each Accounts reading, or the whole item for other styles.
  public let mark: MenuTone?
  public let slotMarks: [MenuTone?]
  /// Live logo and room: the slot with least room, shown as its figure beside the glyph.
  public let liveRoom: MenuReading?
  public let summary: String
  /// One line per account, for the pointer: one-icon styles carry no names.
  public let tooltip: String

  /// `visible` is the accounts the owner has not hidden; `all` is read only when a slot pins
  /// an account. `sources` are the states of every source, `ready` is true once the first read
  /// finished.
  public init(
    style: DisplayPreferences.ItemStyle, preferences: DisplayPreferences,
    visible: [AccountItem], all: @autoclosure () -> [AccountItem] = [],
    sources: [SourceState], ready: Bool, unread: Int, now: Date, sample: Bool = false,
    sampleLow: Bool = false
  ) {
    self.style = style
    logos = preferences.providerLogos
    colors = preferences.colorLowOut
    markStyle = preferences.markStyle
    let slots: [DisplayPreferences.MenuSlot] =
      switch style {
      case .logo: []
      case .logoAndRoom: Array(preferences.slots.prefix(1))
      case .liveLogo, .dots, .accounts: preferences.slots
      }
    // Chosen accounts first, so a tightest slot never repeats one of them.
    var taken = Set(slots.compactMap(\.account))
    // Built once: each read of `allAccounts` rebuilds and sorts the whole list.
    let everyAccount = slots.contains { $0.account != nil } ? all() : []
    let columns: [RoomColumn?] = slots.map { slot in
      if let id = slot.account {
        return everyAccount.first { $0.id == id }.map { RoomColumn(item: $0, now: now) }
      }
      let pick = Self.tightest(visible, excluding: taken, now: now)
      if let pick { taken.insert(pick.id) }
      return pick
    }
    // Logo and room shows only the first slot's account.
    let followed = columns.first ?? nil
    var readings: [MenuReading] = []
    if style.showsSlots {
      for (slot, column) in zip(slots, columns) {
        if let column {
          readings.append(
            MenuReading(column: column, look: slot.look, now: now, view: preferences.limitsView))
        }
      }
      if sample && readings.isEmpty {
        readings = MenuReading.samples(slots.map(\.look), view: preferences.limitsView)
      }
    }
    if sampleLow, let last = readings.indices.last {
      readings[last].left = 15
      readings[last].fill = Formatting.shown(15, view: preferences.limitsView)
      readings[last].text = Formatting.barePercent(readings[last].fill)
      readings[last].tone = .low
      readings[last].bars = [
        MenuReading.Bar(fill: readings[last].fill, tone: .low),
        MenuReading.Bar(fill: Formatting.shown(45, view: preferences.limitsView), tone: .plain),
      ]
    }
    self.readings = readings

    let shown = Set(columns.compactMap { $0?.id })
    let anyOut = visible.contains { $0.binding?.percentLeft == 0 }
    let needsSignIn = visible.contains {
      $0.snapshot.state == .signedOut || $0.account.state == .reconnect_required
    }
    let problem = visible.contains {
      !shown.contains($0.id)
        && ($0.binding?.percentLeft == 0 || $0.snapshot.state == .signedOut
          || $0.account.state == .reconnect_required)
    }
    let unreadDot: MenuTone? = unread > 0 ? .plain : nil
    let problemDot: MenuTone? = problem ? .out : unreadDot

    var text: String?
    var textTone = MenuTone.plain
    if style == .logoAndRoom {
      if let column = followed {
        text = MenuReading.text(column, long: true, view: preferences.limitsView)
        textTone = MenuReading.tone(column.state)
      } else {
        // Nil when there is nothing to report: no source yet, or sources with no accounts.
        text =
          if needsSignIn {
            "!"
          } else if anyOut {
            "Out"
          } else if sources.isEmpty {
            nil
          } else if !ready || sources.contains(where: { $0 != .connected }) {
            "…"
          } else {
            visible.isEmpty ? nil : "Unknown"
          }
        textTone = needsSignIn || anyOut ? .out : .plain
      }
      if sample && text == nil { text = Formatting.share(64, view: preferences.limitsView) }
    }
    if sampleLow && (style == .logo || style == .logoAndRoom) {
      textTone = .low
      if style == .logoAndRoom { text = Formatting.share(15, view: preferences.limitsView) }
    }
    self.text = text
    self.textTone = textTone
    // Out first, then the least room left; a slot with no figure never stands for the rest.
    liveRoom =
      style == .liveLogo && preferences.liveRoom
      ? readings.min { Self.urgency($0) > Self.urgency($1) } : nil
    let tones = [textTone, liveRoom?.tone ?? .plain] + readings.map(\.loudestTone)
    let loudest = tones.max { $0.rank < $1.rank } ?? .plain
    if colors && markStyle != .dot {
      if style == .accounts {
        mark = nil
        slotMarks = readings.map { $0.loudestTone == .plain ? nil : $0.loudestTone }
        dot = problemDot
      } else {
        let tone = problem ? .out : loudest
        mark = tone == .plain ? nil : tone
        slotMarks = readings.map { _ in nil }
        dot = unreadDot
      }
    } else {
      mark = nil
      slotMarks = readings.map { _ in nil }
      // Preserve the original Dot rule, including the plain hidden-problem dot when off.
      dot =
        if colors && loudest.rank > (problemDot ?? .plain).rank { loudest } else { problemDot }
    }

    let lines: [String]
    if style == .logoAndRoom {
      lines = [
        "\(followed?.item.name ?? "Tightest account"): \(text ?? "no readings yet")"
      ]
    } else {
      lines = readings.map { "\($0.name): \(Self.figure($0, view: preferences.limitsView))" }
    }
    tooltip = (["Headroom"] + lines).joined(separator: "\n")

    var parts = ["Headroom"]
    if style == .logoAndRoom {
      parts.append(followed?.item.name ?? "all accounts")
      parts.append(text ?? "no readings yet")
    } else {
      parts += readings.map { "\($0.name), \(Self.figure($0, view: preferences.limitsView))" }
    }
    if unread > 0 { parts.append("\(unread) unread notifications") }
    summary = parts.joined(separator: ", ")
  }

  /// Synthetic card previews follow the current Show style, slots and limits view.
  public static func markSample(preferences: DisplayPreferences) -> MenuStatus {
    MenuStatus(
      style: preferences.itemStyle, preferences: preferences, visible: [], sources: [],
      ready: true, unread: 0, now: Date(timeIntervalSince1970: 0), sample: true, sampleLow: true)
  }

  /// "37% left", or the slot's word when it has no figure to give.
  private static func figure(_ reading: MenuReading, view: DisplayPreferences.LimitsView) -> String
  {
    reading.left != nil && reading.tone != .out
      ? Formatting.share(reading.left, view: view) : reading.text
  }

  private static func urgency(_ reading: MenuReading) -> Double {
    if reading.tone == .out { return 200 }
    return reading.left.map { 100 - $0 } ?? -1
  }

  /// The connected account with the least room that still has some, ranked by a projected
  /// run-out first. When none has room, an out account, so the slot says so.
  private static func tightest(_ items: [AccountItem], excluding taken: Set<String>, now: Date)
    -> RoomColumn?
  {
    var best: (column: RoomColumn, rank: Double)?
    var out: RoomColumn?
    for item in items where !taken.contains(item.id) && item.snapshot.state == .connected {
      let column = RoomColumn(item: item, now: now)
      if column.state == .out {
        out = out ?? column
        continue
      }
      guard column.hasRoom, let left = column.percentLeft else { continue }
      let rank = column.runsOutAt != nil ? 200 : 100 - left
      if best.map({ rank > $0.rank }) ?? true { best = (column, rank) }
    }
    return best?.column ?? out
  }

  /// True for colored dots, chips, stripes, or a provider mark in its own color.
  /// A one-color label is a template image the menu bar tints like any icon.
  public var colored: Bool {
    let marks =
      style == .accounts && logos
      && readings.contains { Presentation.coloredMarks.contains($0.provider) }
    let coloredMark =
      (markStyle == .chip || markStyle == .stripe)
      && (mark != nil || slotMarks.contains { $0 != nil })
    return (colors && (dot ?? .plain) != .plain) || coloredMark || marks
  }
}
