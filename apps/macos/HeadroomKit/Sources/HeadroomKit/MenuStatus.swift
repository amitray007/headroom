import Foundation

/// How much attention one figure in the menu bar needs.
public enum MenuTone: Equatable, Sendable { case plain, low, out }

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
  /// Unread notifications (plain) or an account out or signed out outside the slots (out).
  public let dot: MenuTone?
  public let logos: Bool
  public let colors: Bool
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
    sources: [SourceState], ready: Bool, unread: Int, now: Date, sample: Bool = false
  ) {
    self.style = style
    logos = preferences.providerLogos
    colors = preferences.colorLowOut
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
    dot = problem ? .out : unread > 0 ? .plain : nil

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
    self.text = text
    self.textTone = textTone
    // Out first, then the least room left; a slot with no figure never stands for the rest.
    liveRoom =
      style == .liveLogo && preferences.liveRoom
      ? readings.min { Self.urgency($0) > Self.urgency($1) } : nil

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

  /// True when the label draws in color: a low or out tone, or a provider mark in its own color.
  /// A one-color label is a template image the menu bar tints like any icon.
  public var colored: Bool {
    let tones =
      [textTone, dot ?? .plain, liveRoom?.tone ?? .plain]
      + readings.flatMap { [$0.tone] + $0.bars.map(\.tone) }
    let marks =
      style == .accounts && logos
      && readings.contains { Presentation.coloredMarks.contains($0.provider) }
    return (colors && tones.contains { $0 != .plain }) || marks
  }
}
