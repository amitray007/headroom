import HeadroomKit
import SwiftUI

struct NoticesView: View {
  @Bindable var model: AppModel
  var back: () -> Void
  @State private var unreadOnly = false
  @State private var selected: NoticeItem?
  @FocusState private var focused: String?

  var body: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 8) {
          Button(action: back) { Image(systemName: "chevron.left") }.buttonStyle(ToolButtonStyle())
            .accessibilityLabel("Back to accounts")
          Text("Notices").font(HR.font(14, .semibold)).accessibilityAddTraits(.isHeader)
          Text("\(model.unread) unread").foregroundStyle(HR.secondary).accessibilityValue(
            "\(model.unread) unread notices")
          Spacer()
        }
        HStack(spacing: 6) {
          Button("Mark all as read") { Task { await model.markAllRead() } }
            .buttonStyle(HRButtonStyle()).disabled(model.unread == 0)
          Button("Unread") { unreadOnly = true }.buttonStyle(HRButtonStyle(selected: unreadOnly))
            .focused($focused, equals: "unread-filter")
            .accessibilityAddTraits(unreadOnly ? .isSelected : [])
          Button("All") { unreadOnly = false }.buttonStyle(HRButtonStyle(selected: !unreadOnly))
            .accessibilityAddTraits(!unreadOnly ? .isSelected : [])
        }.font(HR.font(12))
      }.padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
      Divider().overlay(HR.border)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            if items.isEmpty {
              ArtState(
                art: "no-notices", title: unreadOnly ? "No unread notices" : "No notices",
                message: "You are up to date.")
            } else {
              ForEach([true, false], id: \.self) { today in
                let grouped = items.filter { isToday($0) == today }
                if !grouped.isEmpty {
                  Text(today ? "Today" : "Earlier").hrHeading().padding(.vertical, 10)
                  ForEach(grouped) { item in
                    noticeRow(item).id(item.id).focused($focused, equals: item.id)
                  }
                }
              }
            }
          }.padding(.horizontal, 16)
        }
        .frame(height: items.isEmpty ? 270 : 520)
        .onKeyPress(.home) {
          if let first = items.first {
            focused = first.id
            proxy.scrollTo(first.id, anchor: .top)
          }
          return .handled
        }
        .onKeyPress(.end) {
          if let last = items.last {
            focused = last.id
            proxy.scrollTo(last.id, anchor: .bottom)
          }
          return .handled
        }
      }
    }
    .onAppear { selectBanner() }
    .onChange(of: model.bannerNoticeID) { _, _ in selectBanner() }
    .onChange(of: model.notices.count) { _, _ in selectBanner() }
    .onExitCommand(perform: back)
    .sheet(item: $selected) { item in
      NoticeDetail(model: model, item: item) {
        selected = nil
        focused =
          items.contains(where: { $0.id == item.id }) ? item.id : items.first?.id ?? "unread-filter"
      }
    }
  }

  private func selectBanner() {
    guard let id = model.bannerNoticeID, let item = model.notices.first(where: { $0.id == id })
    else { return }
    unreadOnly = false
    selected = item
    focused = id
    model.bannerNoticeID = nil
  }

  private var items: [NoticeItem] { model.notices.filter { !unreadOnly || !$0.read } }
  private func isToday(_ item: NoticeItem) -> Bool {
    let date = item.notice.occurredAt
    return Calendar.current.isDate(date, inSameDayAs: model.now)
  }
  private func noticeRow(_ item: NoticeItem) -> some View {
    Button {
      Task {
        await model.setRead(true, item: item)
        var read = item
        read.read = true
        selected = read
      }
    } label: {
      VStack(alignment: .leading, spacing: 8) {
        Text(toneLabel(item) + (item.read ? "" : " · Unread"))
          .font(HR.font(11)).foregroundStyle(tone(item))
        Text(item.notice.title).font(HR.font(13, item.read ? .medium : .semibold))
          .fixedSize(horizontal: false, vertical: true)
        Text(
          "\(item.notice.accountLabel) · \(item.source.source.name) · \(Formatting.age(item.notice.occurredAt, now: model.now))"
        )
        .font(HR.font(11)).foregroundStyle(HR.secondary).fixedSize(
          horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).padding(
        .vertical, 16
      )
      .background(item.read ? HR.surface : HR.muted)
      .overlay(alignment: .leading) { if !item.read { Rectangle().fill(HR.ink).frame(width: 3) } }
      .overlay(alignment: .bottom) { Rectangle().fill(HR.border).frame(height: 1) }
      .contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityLabel(
      "\(item.read ? "Read" : "Unread"). \(item.notice.title). \(item.source.source.name). Open notice"
    )
    .contextMenu {
      Button(item.read ? "Mark as unread" : "Mark as read") {
        Task { await model.setRead(!item.read, item: item) }
      }
    }
  }
  private func tone(_ item: NoticeItem) -> Color {
    switch item.notice.tone {
    case .bad: HR.danger
    case .warn: HR.warning
    case .info: HR.secondary
    }
  }
  private func toneLabel(_ item: NoticeItem) -> String {
    switch item.notice.tone {
    case .bad: "Attention"
    case .warn: "Warning"
    case .info: "Update"
    }
  }
}

struct NoticeDetail: View {
  let model: AppModel
  let item: NoticeItem
  var close: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(
        "\(Formatting.age(item.notice.occurredAt, now: model.now)) · Read"
      )
      .font(HR.font(12)).foregroundStyle(HR.secondary)
      Text(item.notice.title).font(HR.font(18, .semibold)).accessibilityAddTraits(.isHeader)
      Text(item.notice.message).font(HR.font(15)).fixedSize(horizontal: false, vertical: true)
      Text(
        "\(item.notice.accountLabel) · \(item.source.source.name)"
      )
      .font(HR.font(12)).foregroundStyle(HR.secondary)
      HStack(spacing: 8) {
        Button("Open in web dashboard") {
          model.openDashboard(item.source.source, accountID: item.notice.accountID)
        }
        .keyboardShortcut(.defaultAction)
        Button("Mark as unread") {
          Task {
            await model.setRead(false, item: item)
            close()
          }
        }
        Button("Close", action: close).keyboardShortcut(.cancelAction)
      }.font(HR.font(11)).buttonStyle(HRButtonStyle())
    }
    .padding(24).frame(width: 460, alignment: .leading)
    .foregroundStyle(HR.ink).background(HR.surface).preferredColorScheme(model.colorScheme)
  }
}
