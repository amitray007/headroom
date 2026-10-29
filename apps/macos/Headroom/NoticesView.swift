import HeadroomKit
import SwiftUI

struct NoticesView: View {
  @Bindable var model: AppModel
  var back: () -> Void
  @State private var unreadOnly = false
  @State private var expanded: Set<String> = []
  @FocusState private var focused: String?

  private var items: [NoticeItem] {
    model.notices.filter { !unreadOnly || !$0.read || expanded.contains($0.id) }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Notices").font(HR.popoverFont(16, .medium)).accessibilityAddTraits(.isHeader)
        Spacer()
        if model.noticePhase == .ready && !items.isEmpty {
          Text("\(model.unread) unread").font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
            .accessibilityLabel("\(model.unread) unread notices")
        }
        Button("Close", action: back).buttonStyle(.plain).font(HR.popoverFont(12))
          .padding(.leading, 8).accessibilityLabel("Back to Home")
      }.padding(.horizontal, 16).frame(height: 52)
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
          }.buttonStyle(.plain)
        }
      } else if model.notices.isEmpty {
        PopoverState(
          art: "no-notices", title: "All clear",
          message: "No new notices. Your accounts are in Home."
        ) {
          Button("View accounts", action: back).buttonStyle(.plain)
        }
      } else {
        toolbar
        ScrollViewReader { proxy in
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              if items.isEmpty {
                PopoverState(
                  art: "no-notices", title: "All caught up", message: "No unread notices."
                ) { EmptyView() }
              }
              ForEach(items) { item in noticeRow(item).id(item.id) }
            }.padding(.horizontal, 16)
          }.frame(height: items.isEmpty ? 330 : 588)
            .onChange(of: model.bannerNoticeID) { _, id in
              if let id { proxy.scrollTo(id, anchor: .top) }
            }
            .onChange(of: focused) { _, id in
              if let id { proxy.scrollTo(id) }
            }
        }
      }
    }
    .onAppear {
      if model.synthetic && model.captureState == "notice-expanded", let first = model.notices.first
      {
        expand(first)
      }
      selectBanner()
    }
    .onChange(of: model.bannerNoticeID) { _, _ in selectBanner() }
    .onKeyPress(.escape) {
      if let id = focused, expanded.contains(id) {
        expanded.remove(id)
      } else {
        back()
      }
      return .handled
    }
  }

  private var toolbar: some View {
    HStack(spacing: 4) {
      Button("All") { unreadOnly = false }.buttonStyle(NoticeFilterStyle(selected: !unreadOnly))
        .accessibilityAddTraits(!unreadOnly ? .isSelected : [])
      Button("Unread") { unreadOnly = true }.buttonStyle(NoticeFilterStyle(selected: unreadOnly))
        .focused($focused, equals: "unread-filter").accessibilityAddTraits(
          unreadOnly ? .isSelected : [])
      Spacer()
      Button("Mark all as read") {
        Task {
          await model.markAllRead()
          if unreadOnly { expanded.removeAll() }
        }
      }
      .buttonStyle(.plain).underline().disabled(model.unread == 0)
    }.font(HR.popoverFont(11)).padding(.horizontal, 16).padding(.bottom, 12)
      .overlay(alignment: .bottom) { Rectangle().fill(HR.border).frame(height: 1) }
  }

  private func expand(_ item: NoticeItem) {
    expanded.insert(item.id)
    Task { await model.setRead(true, item: item) }
  }
  private func selectBanner() {
    guard let id = model.bannerNoticeID, let item = model.notices.first(where: { $0.id == id })
    else { return }
    unreadOnly = false
    expand(item)
    focused = id
    model.bannerNoticeID = nil
  }

  private func noticeRow(_ item: NoticeItem) -> some View {
    let open = expanded.contains(item.id)
    return VStack(alignment: .leading, spacing: 0) {
      Button {
        if open { expanded.remove(item.id) } else { expand(item) }
      } label: {
        HStack(alignment: .top, spacing: 8) {
          Circle().fill(item.read ? .clear : HR.ink).frame(width: 5, height: 5).padding(.top, 5)
            .frame(width: 7)
          VStack(alignment: .leading, spacing: 2) {
            Text(item.notice.title).font(HR.popoverFont(12, item.read ? .regular : .medium))
              .foregroundStyle(item.read ? HR.secondary : HR.ink)
              .lineSpacing(2).fixedSize(horizontal: false, vertical: true)
            Text(
              "\(item.notice.accountLabel) · \(Formatting.age(item.notice.occurredAt, now: model.now))"
            )
            .font(HR.popoverFont(11)).foregroundStyle(HR.secondary)
          }.frame(maxWidth: .infinity, alignment: .leading)
          Image(systemName: open ? "chevron.down" : "chevron.right")
            .font(.system(size: 9)).foregroundStyle(HR.secondary).frame(width: 10).padding(.top, 4)
        }.padding(.vertical, 6).contentShape(Rectangle())
      }.buttonStyle(.plain).focused($focused, equals: item.id)
        .accessibilityLabel(
          "\(item.read ? "Read" : "Unread"). \(item.notice.title). \(item.notice.accountLabel). \(Formatting.age(item.notice.occurredAt, now: model.now))"
        )
        .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open {
        Text(item.notice.message).font(HR.popoverFont(12)).lineSpacing(5)
          .fixedSize(horizontal: false, vertical: true).padding(.leading, 15).padding(.top, 4)
          .padding(.bottom, 8)
        HStack {
          Button("Mark unread") {
            Task {
              await model.setRead(false, item: item)
              expanded.remove(item.id)
              focused = item.id
            }
          }.accessibilityLabel("Mark \(item.notice.title) as unread")
          Spacer()
          Button("Open dashboard") {
            model.openDashboard(item.source.source, accountID: item.notice.accountID)
          }
        }.font(HR.popoverFont(11)).buttonStyle(.plain).underline().foregroundStyle(HR.secondary)
          .padding(.leading, 15).frame(minHeight: 24)
      }
    }
    .padding(.horizontal, open ? 8 : 0).padding(.top, open ? 4 : 0).padding(.bottom, open ? 8 : 0)
    .background(open ? HR.muted : HR.surface, in: RoundedRectangle(cornerRadius: 5))
    .padding(.vertical, 8)
    .overlay(alignment: .bottom) { Rectangle().fill(HR.border).frame(height: 1) }
  }

  private var skeletons: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Reading notices…").font(HR.popoverFont(11)).foregroundStyle(HR.secondary).frame(
        height: 16
      ).padding(
        .bottom, 12)
      ForEach(0..<7, id: \.self) { _ in
        HStack {
          GeometryReader { geometry in
            VStack(alignment: .leading, spacing: 7) {
              Rectangle().fill(HR.muted).frame(width: geometry.size.width * 0.6, height: 10)
              Rectangle().fill(HR.muted).frame(width: geometry.size.width * 0.35, height: 10)
            }
          }.frame(height: 27)
          Spacer(minLength: 16)
          Rectangle().fill(HR.muted).frame(width: 14, height: 14)
        }.frame(height: 49)
        Divider().overlay(HR.border)
      }
    }.padding(.horizontal, 16).accessibilityElement(children: .ignore).accessibilityLabel(
      "Reading notices")
  }
}

private struct NoticeFilterStyle: ButtonStyle {
  let selected: Bool
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.padding(.horizontal, 8).padding(.vertical, 6)
      .background(
        selected || configuration.isPressed ? HR.muted : .clear,
        in: RoundedRectangle(cornerRadius: 6)
      )
      .contentShape(Rectangle())
  }
}
