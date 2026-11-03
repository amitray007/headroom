import SwiftUI

// The web dashboard's Settings controls (apps/web/src/styles), ported so the Mac Settings window
// reads as the same product: pill buttons, Arc switches and segments, uppercase section heads,
// title-and-note rows, pill fields and the tile empty state.
extension HR {
  static let raisedSurface = color(light: 0xFFFFFF, dark: 0x1F1F1F)
  static let borderSubtle = color(light: 0xF0F0F0, dark: 0x222222)
  static let borderStrong = color(light: 0xC4C4C4, dark: 0x484848)
  static let textMuted = color(light: 0x717171, dark: 0x898989)
  static let accent = color(light: 0x2E2E2E, dark: 0xCACACA)
  /// `color-mix(foreground 14%, surface)`: the off switch track.
  static let switchOff = color(light: 0xDCDCDC, dark: 0x3A3A3A)
  static let switchOffHover = color(light: 0xC9C9C9, dark: 0x4A4A4A)
  static let pressed = color(light: 0xEDEDED, dark: 0x2A2A2A)
}

/// `.btn`: 36 pt (30 pt small) pills, 14/500 labels, a short press scale.
struct WebButtonStyle: ButtonStyle {
  enum Kind { case secondary, primary, quiet, danger }
  var kind: Kind = .secondary
  var small = false

  func makeBody(configuration: Configuration) -> some View {
    WebButton(configuration: configuration, kind: kind, small: small)
  }

  private struct WebButton: View {
    let configuration: Configuration
    let kind: Kind
    let small: Bool
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false

    var body: some View {
      let live = enabled && hovered
      configuration.label
        .font(HR.popoverFont(small ? 13 : 14, .medium)).lineLimit(1)
        .padding(.horizontal, kind == .quiet || small ? 12 : 16)
        .frame(height: small ? 30 : 36)
        .foregroundStyle(foreground(live))
        .background(background(live), in: Capsule())
        .overlay(Capsule().strokeBorder(border(live), lineWidth: 1))
        .shadow(
          color: .black.opacity(live && kind != .primary && kind != .quiet ? 0.3 : 0), radius: 1,
          y: 1
        )
        .opacity(enabled ? (kind == .primary && configuration.isPressed ? 0.84 : 1) : 0.52)
        .scaleEffect(configuration.isPressed && enabled ? 0.98 : 1)
        .animation(Motion.press(configuration.isPressed), value: configuration.isPressed)
        .animation(Motion.hover, value: hovered)
        .contentShape(Capsule())
        .onHover { hovered = $0 }
    }

    private func foreground(_ live: Bool) -> Color {
      switch kind {
      case .primary: HR.background
      case .danger: HR.danger
      case .quiet: live ? HR.ink : HR.secondary
      case .secondary: HR.ink
      }
    }
    private func background(_ live: Bool) -> Color {
      if kind == .primary { return HR.ink }
      if configuration.isPressed && enabled { return HR.pressed }
      if kind == .quiet { return live ? HR.muted : .clear }
      return live ? HR.muted : HR.surface
    }
    private func border(_ live: Bool) -> Color {
      switch kind {
      case .primary: HR.ink
      case .quiet: .clear
      case .danger: live ? HR.danger : HR.border
      case .secondary: live ? HR.borderStrong : HR.border
      }
    }
  }
}

/// Arc's switch: a 42 by 24 track, an 18 pt thumb that glides across, a foreground fill when on.
struct WebSwitchStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    WebSwitch(configuration: configuration)
  }
  private struct WebSwitch: View {
    let configuration: Configuration
    @Environment(\.isEnabled) private var enabled
    @State private var hovered = false
    var body: some View {
      let on = configuration.isOn
      Button {
        configuration.isOn.toggle()
      } label: {
        ZStack(alignment: on ? .trailing : .leading) {
          Capsule().fill(on ? HR.ink : hovered && enabled ? HR.switchOffHover : HR.switchOff)
          Circle().fill(on ? HR.background : HR.raisedSurface)
            .shadow(color: .black.opacity(0.14), radius: 1, y: 1)
            .overlay(Circle().strokeBorder(.black.opacity(0.07), lineWidth: 0.5))
            .frame(width: 18, height: 18).padding(3)
        }
        .frame(width: 42, height: 24)
        .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.3), value: on)
      }
      .buttonStyle(.plain).opacity(enabled ? 1 : 0.5).onHover { hovered = $0 }
      .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
  }
}

/// `.seg`: a muted pill track with the chosen option raised.
struct WebSegmented<Value: Hashable>: View {
  @Binding var selection: Value
  let options: [(Value, String)]
  /// 12 pt labels on a 24 pt track, for a control inside a row.
  var compact = false
  var body: some View {
    HStack(spacing: compact ? 2 : 3) {
      ForEach(options, id: \.0) { value, label in
        let chosen = selection == value
        Button {
          selection = value
        } label: {
          Text(label).font(HR.popoverFont(compact ? 12 : 13, .medium))
            .foregroundStyle(chosen ? HR.ink : HR.secondary)
            .padding(.horizontal, compact ? 10 : 12).frame(height: compact ? 24 : 28)
            .background {
              if chosen {
                Capsule().fill(HR.raisedSurface).shadow(
                  color: .black.opacity(0.18), radius: 1, y: 1)
              }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain).accessibilityAddTraits(chosen ? .isSelected : [])
      }
    }
    .padding(compact ? 2 : 3).background(HR.muted, in: Capsule())
    .animation(.easeOut(duration: 0.16), value: selection)
  }
}

/// `.dsec`: an uppercase muted head, then rows separated by subtle rules.
struct SettingsSection<Content: View, Accessory: View>: View {
  let title: String
  @ViewBuilder var accessory: Accessory
  @ViewBuilder var content: Content
  init(
    _ title: String, @ViewBuilder accessory: () -> Accessory = { EmptyView() },
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.accessory = accessory()
    self.content = content()
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(title.uppercased()).font(HR.popoverFont(12, .medium)).tracking(0.24)
          .foregroundStyle(HR.textMuted).accessibilityAddTraits(.isHeader)
        Spacer()
        accessory
      }.frame(minHeight: 32)
      VStack(alignment: .leading, spacing: 0) {
        Group(subviews: content) { rows in
          ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
            if index > 0 { Rectangle().fill(HR.borderSubtle).frame(height: 1) }
            row
          }
        }
      }
    }
    .padding(.horizontal, 24).padding(.top, 10).padding(.bottom, 14)
  }
}

/// `.srow`: a 14/500 title with a 12 pt muted note on the left, its control on the right.
struct SettingsRow<Control: View>: View {
  let title: String
  var note = ""
  @ViewBuilder var control: Control
  var body: some View {
    HStack(spacing: 40) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink)
        if !note.isEmpty {
          Text(note).font(HR.popoverFont(12)).foregroundStyle(HR.textMuted).lineSpacing(1.5)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      control
    }
    .padding(.vertical, 10)
  }
}

/// `.empty.compact`: a bordered tile with a glyph, a title, one plain line and its actions.
struct SettingsEmpty<Actions: View>: View {
  let symbol: String
  let title: String
  let message: String
  @ViewBuilder var actions: Actions
  var body: some View {
    VStack(spacing: 0) {
      Image(systemName: symbol).font(.system(size: 18, weight: .regular))
        .foregroundStyle(HR.secondary)
        .frame(width: 40, height: 40)
        .background(HR.muted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(HR.border)
        )
        .accessibilityHidden(true)
      Text(title).font(HR.popoverFont(14, .medium)).foregroundStyle(HR.ink).padding(.top, 12)
        .accessibilityAddTraits(.isHeader)
      Text(message).font(HR.popoverFont(13)).foregroundStyle(HR.secondary).lineSpacing(2)
        .multilineTextAlignment(.center).frame(maxWidth: 320).padding(.top, 4)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 12) { actions }.padding(.top, 20)
    }
    .frame(maxWidth: .infinity).padding(.vertical, 40).padding(.horizontal, 24)
  }
}

/// `.field`: a 13 pt secondary label over a 40 pt pill input with a strong border.
struct WebField<Input: View>: View {
  let label: String
  @ViewBuilder var input: Input
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label).font(HR.popoverFont(13)).foregroundStyle(HR.secondary)
      input.textFieldStyle(.plain).font(HR.popoverFont(14)).foregroundStyle(HR.ink)
        .padding(.horizontal, 16).frame(height: 40)
        .background(HR.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(HR.borderStrong))
    }
  }
}

/// The select trigger: a pill with the chosen value and a chevron, opening a native menu.
struct WebSelect<Content: View>: View {
  let value: String
  /// A provider mark, or failing that a symbol, before the value.
  var mark: String? = nil
  var symbol: String? = nil
  /// Takes the row's free width, with the chevron at the trailing edge.
  var fill = false
  @ViewBuilder var content: Content
  var body: some View {
    Menu {
      content
    } label: {
      HStack(spacing: 8) {
        if let mark {
          ProviderMark(provider: mark).frame(width: 14, height: 14)
        } else if let symbol {
          Image(systemName: symbol).font(.system(size: 12, weight: .medium))
            .foregroundStyle(HR.secondary).frame(width: 14)
        }
        Text(value).font(HR.popoverFont(13, .medium)).lineLimit(1)
        if fill { Spacer(minLength: 8) }
        Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold))
          .foregroundStyle(HR.secondary)
      }
      .foregroundStyle(HR.ink).padding(.horizontal, 14).frame(height: 32)
      .background(HR.surface, in: Capsule())
      .overlay(Capsule().strokeBorder(HR.border))
      .contentShape(Capsule())
    }
    .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
    .fixedSize(horizontal: !fill, vertical: true)
    .frame(maxWidth: fill ? .infinity : nil)
  }
}
