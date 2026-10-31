import HeadroomKit
import SwiftUI

/// The web app's notification centre at popover size: a status header, All and Unread, then
/// rows grouped by day. Opening a row marks it read and shows the whole message.
struct NoticesView: View {
  @Bindable var model: AppModel
  var back: () -> Void
  @State private var unreadOnly = false
  @State private var expanded: Set<String> = []
  @State private var listHeight: CGFloat = 0
  @FocusState private var focused: String?
  @Namespace private var filter
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var all: [NoticeItem] { model.popoverNotices }
  private var unread: Int { all.filter { !$0.read }.count }
  private var items: [NoticeItem] {
    all.filter { !unreadOnly || !$0.read || expanded.contains($0.id) }
  }
  private var days: [(day: NoticeDay, items: [NoticeItem])] {
    NoticeDay.allCases.compactMap { day in
      let group = items.filter { NoticeDay($0.notice.occurredAt, now: model.now) == day }
      return group.isEmpty ? nil : (day, group)
    }
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
    .onAppear {
      if model.synthetic && model.captureState == "notice-expanded", let first = all.first {
        expand(first)
      }
      selectBanner()
    }
    .onChange(of: model.bannerNoticeID) { _, _ in selectBanner() }
    .onKeyPress(.escape) {
      if let id = focused, expanded.contains(id) {
        _ = withAnimation(Motion.expand(reduceMotion)) { expanded.remove(id) }
      } else {
        back()
      }
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
            if unreadOnly { expanded.removeAll() }
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
                NoticeRow(
                  item: item, open: expanded.contains(item.id), now: model.now,
                  toggle: { toggle(item) }, markUnread: { markUnread(item) }
                ).focused($focused, equals: item.id).id(item.id)
              }
            } header: {
              Text(group.day.rawValue).font(HR.popoverFont(11, .medium))
                .foregroundStyle(HR.textMuted).padding(.horizontal, 8).padding(.top, 12)
                .padding(.bottom, 6).frame(maxWidth: .infinity, alignment: .leading)
                .background(HR.surface).accessibilityAddTraits(.isHeader)
            }
          }
        }.padding(.horizontal, 8).padding(.bottom, 8)
          .onGeometryChange(for: CGFloat.self) {
            $0.size.height
          } action: {
            listHeight = $0
          }
      }.frame(height: min(max(listHeight, 120), 588))
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
    if expanded.contains(item.id) {
      _ = withAnimation(Motion.expand(reduceMotion)) { expanded.remove(item.id) }
    } else {
      expand(item)
    }
  }
  private func expand(_ item: NoticeItem) {
    _ = withAnimation(Motion.expand(reduceMotion)) { expanded.insert(item.id) }
    Task { await model.setRead(true, item: item) }
  }
  private func markUnread(_ item: NoticeItem) {
    Task {
      await model.setRead(false, item: item)
      _ = withAnimation(Motion.expand(reduceMotion)) { expanded.remove(item.id) }
      focused = item.id
    }
  }
  private func selectBanner() {
    guard let id = model.bannerNoticeID, let item = all.first(where: { $0.id == id })
    else { return }
    unreadOnly = false
    expand(item)
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

private struct NoticeRow: View {
  let item: NoticeItem
  let open: Bool
  let now: Date
  let toggle: () -> Void
  let markUnread: () -> Void
  @State private var hovered = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var notice: NativeNotice { item.notice }
  private var unread: Bool { !item.read }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button(action: toggle) {
        HStack(alignment: .top, spacing: 12) {
          tile
          VStack(alignment: .leading, spacing: 3) {
            Text(notice.title)
              .font(HR.popoverFont(13, unread || open ? .medium : .regular))
              .foregroundStyle(unread || open ? HR.ink : HR.secondary).lineLimit(1)
            Text(notice.message).font(HR.popoverFont(12))
              .foregroundStyle(open ? HR.ink : HR.secondary).lineSpacing(open ? 4 : 0)
              .lineLimit(open ? nil : 1).fixedSize(horizontal: false, vertical: open)
            HStack(spacing: 6) {
              if let provider = notice.provider {
                ProviderMark(provider: provider).frame(width: 12, height: 12)
              }
              Text(notice.accountLabel).font(HR.popoverFont(11)).foregroundStyle(HR.textMuted)
            }.lineLimit(1)
          }.frame(maxWidth: .infinity, alignment: .leading)
          VStack(alignment: .trailing, spacing: 8) {
            Text(Formatting.elapsed(notice.occurredAt, now: now)).font(HR.popoverFont(11))
              .foregroundStyle(HR.textMuted).fixedSize()
            Circle().fill(HR.ink).frame(width: 7, height: 7).opacity(unread ? 1 : 0)
              .scaleEffect(unread ? 1 : 0.4).animation(Motion.hover, value: unread)
          }.padding(.top, 2)
        }.padding(10).contentShape(Rectangle())
      }.buttonStyle(.plain)
        .accessibilityLabel(
          "\(unread ? "Unread" : "Read"). \(notice.title). \(notice.accountLabel). \(Formatting.age(notice.occurredAt, now: now))"
        )
        .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open {
        Button("Mark unread", action: markUnread).buttonStyle(NoticePillStyle(height: 26))
          .accessibilityLabel("Mark \(notice.title) as unread")
          .padding(.leading, 54).padding(.bottom, 10)
          .transition(Motion.reveal(reduceMotion))
      }
    }
    .background(background, in: RoundedRectangle(cornerRadius: 10))
    .animation(Motion.hover, value: hovered)
    .onHover { hovered = $0 }
  }

  private var background: Color {
    if open { return HR.muted }
    if hovered { return HR.muted.opacity(0.7) }
    return unread ? HR.ink.opacity(0.05) : .clear
  }

  private var tile: some View {
    let color: Color =
      switch notice.tone {
      case .bad: HR.popoverDanger
      case .warn: HR.popoverWarning
      case .info: HR.secondary
      }
    let quiet = !unread && !open
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
      .scaleEffect(configuration.isPressed && enabled ? 0.96 : 1)
      .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
      .contentShape(Capsule())
  }
}
