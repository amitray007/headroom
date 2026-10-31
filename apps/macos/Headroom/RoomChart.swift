import HeadroomKit
import SwiftUI

struct RoomChart: View {
  let room: RoomNow
  let now: Date
  @State private var selected: String?
  @FocusState private var focused: String?
  @State private var overTip = false
  @State private var dismissal: Task<Void, Never>?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(room.headline).font(HR.popoverFont(13, .medium)).frame(height: 20)
      HStack(alignment: .bottom, spacing: 3) {
        ForEach(Array(room.columns.enumerated()), id: \.element.id) { index, column in
          VStack(spacing: 6) {
            Button {
              selected = selected == column.id ? nil : column.id
            } label: {
              columnPlot(column)
            }
            .buttonStyle(.plain)
            .focused($focused, equals: column.id)
            .accessibilityLabel(column.text(now: now))
            .onHover { inside in
              dismissal?.cancel()
              if inside { selected = column.id } else { dismissLater() }
            }
            .onKeyPress(.leftArrow) {
              move(index, by: -1)
              return .handled
            }
            .onKeyPress(.rightArrow) {
              move(index, by: 1)
              return .handled
            }
            .onKeyPress(.home) {
              focused = room.columns.first?.id
              return .handled
            }
            .onKeyPress(.end) {
              focused = room.columns.last?.id
              return .handled
            }
            chartMark(column.item.account.provider.rawValue)
              .frame(width: 14, height: 14)
          }
          .padding(
            .leading,
            index > 0
              && room.columns[index - 1].item.account.provider != column.item.account.provider
              ? 2 : 0
          )
          .frame(maxWidth: .infinity)
        }
      }.padding(.top, 8)
      Text(nextBack).font(HR.popoverFont(12)).foregroundStyle(HR.secondary)
        .lineLimit(1).padding(.top, 4)
    }
    .frame(height: 140, alignment: .top)
    .overlay(alignment: .top) {
      if let column = room.columns.first(where: { $0.id == selected }) {
        Text(column.text(now: now))
          .font(HR.popoverFont(11)).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
          .foregroundStyle(HR.surface).padding(.horizontal, 12).padding(.vertical, 9)
          .frame(maxWidth: 300, alignment: .leading)
          .background(HR.ink, in: RoundedRectangle(cornerRadius: 6))
          .shadow(color: .black.opacity(0.15), radius: 6, y: 4)
          .offset(y: 24)
          .onHover { inside in
            overTip = inside
            if inside { dismissal?.cancel() } else { dismissLater() }
          }
          .accessibilityHidden(true)
      }
    }
    .onChange(of: focused) { _, id in
      dismissal?.cancel()
      selected = id
    }
    .onKeyPress(.escape) {
      selected = nil
      return .handled
    }
    .onDisappear { dismissal?.cancel() }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Room now. \(room.headline). Use arrow keys to compare accounts")
  }

  private var nextBack: String {
    guard let next = room.nextBack else { return "Next back · No accounts out" }
    return
      "Next back · \(next.item.name) · \(Formatting.when(Formatting.date(milliseconds: next.limit?.resetsAt), now: now))"
  }

  private func move(_ index: Int, by offset: Int) {
    focused = room.columns[max(0, min(room.columns.count - 1, index + offset))].id
  }
  private func dismissLater() {
    dismissal = Task { @MainActor in
      do { try await Task.sleep(for: .milliseconds(180)) } catch { return }
      if !overTip && focused == nil { selected = nil }
    }
  }

  private func chartMark(_ provider: String) -> some View {
    // The Codex SVG includes transparent padding. Crop only this 14 pt chart copy.
    ProviderMark(provider: provider)
      .scaleEffect(provider == "codex" ? 1.5 : 1)
      .frame(width: 14, height: 14).clipped()
  }

  private func columnPlot(_ column: RoomColumn) -> some View {
    ZStack(alignment: .bottom) {
      if column.state == .room || column.state == .tight || column.state == .kept {
        Rectangle().fill(
          column.state == .tight
            ? HR.popoverWarning : HR.secondary.opacity(column.state == .kept ? 0.45 : 1)
        )
        .frame(height: 64 * (column.percentLeft ?? 0) / 100)
      }
      if column.state == .out {
        Hatch().frame(height: 3)
        Text("Out").font(HR.popoverFont(11)).foregroundStyle(HR.popoverDanger)
          .frame(height: 64)
      } else if column.state == .unknown || column.state == .signIn || column.state == .kept {
        Rectangle().strokeBorder(
          HR.popoverNoData, style: StrokeStyle(lineWidth: 1, dash: [1, 2]))
        if column.state != .kept {
          Group {
            if column.state == .signIn {
              Image(systemName: "lock").font(.system(size: 11))
            } else {
              Text("?").font(HR.popoverFont(11))
            }
          }.foregroundStyle(HR.secondary).frame(height: 64)
        }
      }
      Rectangle().fill(HR.popoverBaseline).frame(height: 0.5)
    }.frame(height: 64, alignment: .bottom).contentShape(Rectangle())
  }
}

struct Hatch: View {
  var body: some View {
    Canvas { context, size in
      for x in stride(from: -size.height, through: size.width, by: 5) {
        var line = Path()
        line.move(to: CGPoint(x: x, y: 0))
        line.addLine(to: CGPoint(x: x + size.height, y: size.height))
        context.stroke(line, with: .color(HR.popoverDanger), lineWidth: 1)
      }
    }.clipped()
  }
}
