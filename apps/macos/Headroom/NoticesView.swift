import HeadroomKit
import SwiftUI

/// The web app's notification centre at popover size: a status header, All and Unread, then
/// rows grouped by day. Clicking a row marks it read; clicking it again marks it unread.
struct NoticesView: View {
  @Bindable var model: AppModel
  /// Fill the height the popover gives, the account page's, instead of sizing to the list.
  var fill = false
  var back: () -> Void
  @State private var unreadOnly = false
  /// Rows read while Unread is shown stay put until the filter changes, so a click never
  /// pulls a row out from under the pointer.
  @State private var kept: Set<String> = []
  @State private var listHeight: CGFloat = 0
  @FocusState private var focused: String?
  @State private var scrolling = false
  @Namespace private var filter
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var all: [NoticeItem] { model.popoverNotices }
  private var unread: Int { all.filter { !$0.read }.count }
  private var items: [NoticeItem] {
    all.filter { !unreadOnly || !$0.read || kept.contains($0.id) }
  }
  /// One pass over the list: each notice's day is worked out once.
  private var days: [(day: NoticeDay, items: [NoticeItem])] {
    var byDay: [NoticeDay: [NoticeItem]] = [:]
    for item in items {
      byDay[NoticeDay(item.notice.occurredAt, now: model.now), default: []].append(item)
    }
    return NoticeDay.allCases.compactMap { day in byDay[day].map { (day, $0) } }
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      if model.noticePhase == .loading {
        skeletons
      } else if model.noticePhase == .failed {
        PopoverState(
          art: "source-offline", title: "Notices could not load",
          message: "Account readings are still available."
        ) {
          Button("Try again") {
            Task {
              await model.readSources()
              await model.loadNotices()
            }
          }.buttonStyle(PopoverActionStyle())
        }
      } else {
        filters
        Rectangle().fill(HR.borderSubtle).frame(height: 1)
        if items.isEmpty {
          empty
        } else {
          list
        }
      }
    }
    .frame(maxHeight: fill ? .infinity : nil, alignment: .top)
    .onAppear {
      if model.synthetic && model.captureState == "notice-expanded", let first = all.first {
        toggle(first)
      }
      selectBanner()
    }
    .onChange(of: model.bannerNoticeID) { _, _ in selectBanner() }
    .onChange(of: unreadOnly) { _, _ in kept.removeAll() }
    .onKeyPress(.escape) {
      back()
      return .handled
    }
  }

  private var header: some View {
    HStack(spacing: 10) {
      Button(action: back) {
        Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
          .foregroundStyle(HR.secondary).frame(width: 28, height: 28)
          .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(HR.border))
          .contentShape(Rectangle())
      }.buttonStyle(.plain).help("Back to accounts").accessibilityLabel("Back to accounts")
      VStack(alignment: .leading, spacing: 1) {
        Text("Notices").font(HR.popoverFont(16, .medium)).accessibilityAddTraits(.isHeader)
        Text(status).font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
          .contentTransition(.numericText()).animation(Motion.data, value: unread)
      }
      Spacer()
      if model.noticePhase == .ready && !all.isEmpty {
        Button("Mark all read") {
          Task {
            await model.markAllRead()
            if unreadOnly { kept.removeAll() }
          }
        }.buttonStyle(NoticePillStyle(height: 28)).disabled(unread == 0)
      }
    }.padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 10)
  }

  private var status: String {
    switch model.noticePhase {
    case .loading: "Reading notices"
    case .failed: "Not available right now"
    case .ready:
      unread == 0
        ? "You are all caught up"
        : "\(unread) \(unread == 1 ? "update" : "updates") waiting for you"
    }
  }

  private var filters: some View {
    HStack(spacing: 0) {
      filterButton("All", count: all.count, selected: !unreadOnly) { unreadOnly = false }
      filterButton("Unread", count: unread, selected: unreadOnly) { unreadOnly = true }
        .focused($focused, equals: "unread-filter")
    }.padding(2).background(HR.muted, in: RoundedRectangle(cornerRadius: 8))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16).padding(.bottom, 12)
  }

  private func filterButton(
    _ title: String, count: Int, selected: Bool, action: @escaping () -> Void
  ) -> some View {
    Button {
      withAnimation(Motion.expand(reduceMotion)) { action() }
    } label: {
      HStack(spacing: 6) {
        Text(title).font(HR.popoverFont(12, selected ? .medium : .regular))
          .foregroundStyle(selected ? HR.ink : HR.secondary)
        Text("\(count)").font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
          .contentTransition(.numericText()).animation(Motion.data, value: count)
      }.padding(.horizontal, 12).frame(height: 24)
        .background {
          if selected {
            RoundedRectangle(cornerRadius: 6).fill(HR.surface)
              .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(HR.border))
              .shadow(color: .black.opacity(0.18), radius: 1, y: 1)
              .matchedGeometryEffect(id: "filter", in: filter)
          }
        }
        .contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityLabel("\(title), \(count)")
      .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var list: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2, pinnedViews: [.sectionHeaders]) {
          ForEach(days, id: \.day) { group in
            Section {
              ForEach(group.items) { item in
                NoticeRow(item: item, now: model.now) { toggle(item) }.equatable()
                  .focused($focused, equals: item.id).id(item.id)
              }
            } header: {
              Text(group.day.rawValue).font(HR.popoverFont(11, .medium))
                .foregroundStyle(HR.textMuted).padding(.horizontal, 8).padding(.top, 12)
                .padding(.bottom, 6).frame(maxWidth: .infinity, alignment: .leading)
                .background(HR.surface).accessibilityAddTraits(.isHeader)
            }
          }
        }.padding(.horizontal, 8).padding(.bottom, 8)
          // Hover waits until the list stops, so rows passing the pointer do not light up.
          .allowsHitTesting(!scrolling)
          .onGeometryChange(for: CGFloat.self) {
            $0.size.height
          } action: {
            listHeight = $0
          }
      }.frame(height: fill ? nil : min(max(listHeight, 120), 588))
        .frame(maxHeight: fill ? .infinity : nil)
        .onScrollPhaseChange { _, phase in scrolling = phase.isScrolling }
        .onChange(of: model.bannerNoticeID) { _, id in
          if let id { proxy.scrollTo(id, anchor: .top) }
        }
        .onChange(of: focused) { _, id in
          if let id { proxy.scrollTo(id) }
        }
    }
  }

  private var empty: some View {
    VStack(spacing: 6) {
      Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold))
        .foregroundStyle(HR.secondary).frame(width: 40, height: 40)
        .background(HR.muted, in: RoundedRectangle(cornerRadius: 11)).padding(.bottom, 6)
        .accessibilityHidden(true)
      Text("Nothing new").font(HR.popoverFont(14, .medium)).accessibilityAddTraits(.isHeader)
      Text(
        unreadOnly && !all.isEmpty
          ? "Every notice is read." : "Limits, resets and sign-in problems show up here."
      ).font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
    }.multilineTextAlignment(.center).frame(maxWidth: .infinity)
      .padding(.horizontal, 24).padding(.top, 56).padding(.bottom, 64)
  }

  private func toggle(_ item: NoticeItem) {
    if unreadOnly { kept.insert(item.id) }
    Task { await model.setRead(!item.read, item: item) }
  }
  private func selectBanner() {
    guard let id = model.bannerNoticeID, let item = all.first(where: { $0.id == id })
    else { return }
    unreadOnly = false
    if !item.read { toggle(item) }
    focused = id
    model.bannerNoticeID = nil
  }

  private var skeletons: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(0..<6, id: \.self) { _ in
        HStack(alignment: .top, spacing: 12) {
          RoundedRectangle(cornerRadius: 9).fill(HR.muted).frame(width: 32, height: 32)
          VStack(alignment: .leading, spacing: 7) {
            Rectangle().fill(HR.muted).frame(width: 260, height: 10)
            Rectangle().fill(HR.muted).frame(width: 180, height: 10)
          }.padding(.top, 4)
          Spacer()
        }.padding(10)
      }
    }.padding(.horizontal, 8).padding(.vertical, 8)
      .overlay(alignment: .top) { Rectangle().fill(HR.borderSubtle).frame(height: 1) }
      .accessibilityElement(children: .ignore).accessibilityLabel("Reading notices")
  }
}

/// Equatable on what it shows, so marking one notice read redraws that row only.
private struct NoticeRow: View, Equatable {
  nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.item.shows(like: rhs.item) && lhs.now == rhs.now
  }

  let item: NoticeItem
  let now: Date
  let toggle: () -> Void
  @State private var hovered = false
  private var notice: NativeNotice { item.notice }
  private var unread: Bool { !item.read }

  var body: some View {
    Button(action: toggle) {
      HStack(alignment: .top, spacing: 12) {
        tile
        VStack(alignment: .leading, spacing: 3) {
          Text(notice.title).font(HR.popoverFont(13, unread ? .medium : .regular))
            .foregroundStyle(unread ? HR.ink : HR.secondary).lineLimit(1)
          Text(notice.message).font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
            .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 6) {
            if let provider = notice.provider {
              ProviderMark(provider: provider).frame(width: 12, height: 12)
            }
            Text(notice.accountLabel).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
          }.lineLimit(1).padding(.top, 1)
        }.frame(maxWidth: .infinity, alignment: .leading)
        VStack(alignment: .trailing, spacing: 6) {
          Text(Formatting.elapsed(notice.occurredAt, now: now)).font(HR.popoverFont(11))
            .foregroundStyle(HR.textMuted).fixedSize()
          readMark
        }.padding(.top, 2)
      }.padding(10)
    }
    .buttonStyle(NoticeRowStyle(unread: unread, hovered: hovered))
    .onHover { hovered = $0 }
    .pointerStyle(.link)
    .help(unread ? "Mark as read" : "Mark as unread")
    .accessibilityLabel(
      "\(unread ? "Unread" : "Read"). \(notice.title). \(notice.message) \(notice.accountLabel). \(Formatting.age(notice.occurredAt, now: now))"
    )
    .accessibilityHint(unread ? "Marks as read" : "Marks as unread")
  }

  /// The unread dot; under the pointer it previews what a click does: a check to mark read, a
  /// ring to mark unread.
  private var readMark: some View {
    ZStack {
      if hovered {
        Image(systemName: unread ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(unread ? HR.ink : HR.textMuted)
          .transition(.scale(scale: 0.6).combined(with: .opacity))
      } else if unread {
        Circle().fill(HR.ink).frame(width: 7, height: 7)
          .transition(.scale(scale: 0.4).combined(with: .opacity))
      }
    }.frame(width: 14, height: 14).animation(Motion.hover, value: hovered)
      .animation(Motion.hover, value: unread).accessibilityHidden(true)
  }

  private var tile: some View {
    let color: Color =
      switch notice.tone {
      case .bad: HR.popoverDanger
      case .warn: HR.popoverWarning
      case .info: HR.secondary
      }
    let quiet = !unread
    return Image(systemName: symbol).font(.system(size: 13, weight: .medium))
      .foregroundStyle(quiet ? HR.textMuted : color).frame(width: 32, height: 32)
      .background(
        quiet || notice.tone == .info ? HR.muted : color.opacity(0.16),
        in: RoundedRectangle(cornerRadius: 9)
      ).accessibilityHidden(true)
  }

  private var symbol: String {
    switch notice.kind {
    case .disconnected: "exclamationmark.triangle"
    case .refresh_failed: "arrow.triangle.2.circlepath"
    case .almost_out, .running_low, .pacing: "gauge.with.dots.needle.33percent"
    case .reset_expiring, .credits_expiring: "hourglass"
    case .reset_granted, .early_reset, .auto_reset: "arrow.counterclockwise"
    case .top_up_detected: "plus.circle"
    case .balance_low, .spend_near_cap, .spend_cap_reached, .extra_usage_started, .budget_near,
      .budget_exceeded:
      "dollarsign.circle"
    }
  }
}

/// The whole row is the button: a fill under the pointer, a darker fill and a small press.
private struct NoticeRowStyle: ButtonStyle {
  let unread: Bool
  let hovered: Bool
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.contentShape(RoundedRectangle(cornerRadius: 10))
      .background(
        configuration.isPressed
          ? HR.track : hovered ? HR.muted : unread ? HR.ink.opacity(0.05) : .clear,
        in: RoundedRectangle(cornerRadius: 10)
      )
      .overlay {
        if hovered { RoundedRectangle(cornerRadius: 10).strokeBorder(HR.border) }
      }
      .scaleEffect(configuration.isPressed ? 0.99 : 1)
      .animation(Motion.press(configuration.isPressed), value: configuration.isPressed)
      .animation(Motion.hover, value: hovered)
      .animation(Motion.hover, value: unread)
  }
}

/// A bordered pill for the Notices actions.
private struct NoticePillStyle: ButtonStyle {
  let height: CGFloat
  @Environment(\.isEnabled) private var enabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(HR.popoverFont(height > 26 ? 12 : 11.5, .medium))
      .foregroundStyle(enabled ? HR.ink : HR.textMuted)
      .padding(.horizontal, height > 26 ? 12 : 10).frame(height: height)
      .background(configuration.isPressed ? HR.track : HR.surface, in: Capsule())
      .overlay(Capsule().strokeBorder(HR.border))
      .scaleEffect(configuration.isPressed && enabled ? 0.97 : 1)
      .animation(Motion.press(configuration.isPressed), value: configuration.isPressed)
      .contentShape(Capsule())
  }
}
