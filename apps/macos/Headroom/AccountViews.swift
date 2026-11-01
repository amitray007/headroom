import HeadroomKit
import SwiftUI

struct ProviderSection: View {
  let provider: String
  let items: [AccountItem]
  let model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 12) {
        HStack(spacing: 8) {
          ProviderMark(provider: provider).frame(width: 16, height: 16)
          Text(Presentation.providerName(provider)).hrHeading().fixedSize()
        }
        Spacer(minLength: 0)
        Text("Left").font(HR.font(11)).foregroundStyle(HR.secondary).frame(
          width: 44, alignment: .trailing)
        Text("Resets").font(HR.font(11)).foregroundStyle(HR.secondary).frame(
          width: 74, alignment: .trailing)
      }
      // Each account uses exactly the provider header's four column widths and 12 pt gaps.
      ForEach(items) { item in AccountBlock(item: item, allItems: model.accounts, model: model) }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(Presentation.providerName(provider)) accounts")
  }
}

struct AccountBlock: View {
  let item: AccountItem
  let allItems: [AccountItem]
  let model: AppModel
  private var account: FeedAccount { item.account }
  private var stale: Bool {
    guard let last = Formatting.date(milliseconds: account.lastSuccessAt),
      let feed = item.snapshot.cached?.feed
    else { return true }
    return model.now.timeIntervalSince(last) * 1000 > Double(feed.staleAfterMs)
  }
  private var signedOut: Bool {
    account.state == .reconnect_required || item.snapshot.state == .signedOut
  }
  private var quiet: Bool { stale || signedOut || item.snapshot.state != .connected }
  private var accountStatus: String? {
    if signedOut { return "Sign in again" }
    if stale { return "Stale" }
    if item.binding?.percentLeft == 0 { return "Out" }
    return nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(account.name).font(HR.font(13, .semibold)).accessibilityAddTraits(.isHeader)
        if let plan = account.plan { Text(plan).font(HR.font(11)).foregroundStyle(HR.secondary) }
        Spacer(minLength: 0)
        if let status = accountStatus {
          Text(status).font(HR.font(11, .medium)).foregroundStyle(
            signedOut || status == "Out" ? HR.danger : HR.secondary)
        }
        Menu {
          Text("\(item.snapshot.source.name) · \(item.snapshot.state.label)")
          Button("Open in web dashboard") {
            model.openDashboard(item.snapshot.source, accountID: account.id)
          }
          Divider()
          Text("\(account.interface.rawValue.capitalized) interface")
          Text(
            "Reading \(Formatting.age(Formatting.date(milliseconds: account.observedAt), now: model.now))"
          )
        } label: {
          Image(systemName: "ellipsis").frame(width: 24, height: 24).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Menu for \(item.name), \(item.snapshot.source.name)")
      }
      if Presentation.needsSource(item, among: allItems) {
        Text(
          item.snapshot.source.name
            + (item.snapshot.state == .connected ? "" : " · \(item.snapshot.state.label)")
        )
        .font(HR.font(11)).foregroundStyle(HR.secondary)
      }
      if quiet {
        Text(
          "Readings from \(Formatting.age(Formatting.date(milliseconds: account.observedAt), now: model.now))."
            + (signedOut ? " Sign in again in the web dashboard." : "")
        )
        .font(HR.font(11)).foregroundStyle(HR.secondary).fixedSize(
          horizontal: false, vertical: true)
      }
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
        ForEach(account.limits, id: \.key) { limit in
          limitRow(limit)
          if let at = Formatting.date(milliseconds: limit.runsOutAt), limit.percentLeft != 0,
            limit.percentLeft != nil
          {
            GridRow {
              Color.clear.frame(width: 78, height: 0)
              Text(Formatting.runOut(at, now: model.now)).font(HR.font(11))
                .foregroundStyle(HR.warning).gridCellColumns(3).frame(
                  width: 298, alignment: .leading
                ).fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        ForEach(account.charges, id: \.key) { charge in
          GridRow {
            Text(displayLabel(charge.label)).lineLimit(1).truncationMode(.tail).help(
              displayLabel(charge.label)
            ).foregroundStyle(HR.secondary).frame(
              width: 78, alignment: .leading)
            if let value = charge.value, let cap = charge.cap, cap.value > 0,
              cap.unit == charge.unit
            {
              GeometryReader { geometry in
                ZStack(alignment: .leading) {
                  Capsule().fill(HR.track)
                  Capsule().fill(HR.fill.opacity(0.75))
                    .frame(width: geometry.size.width * min(1, max(0, value / cap.value)))
                }
              }.frame(width: 156, height: 3)
              Text(Formatting.charge(charge)).gridCellColumns(2).frame(
                width: 130, alignment: .trailing)
            } else {
              Text(Formatting.charge(charge)).gridCellColumns(3).frame(
                width: 298, alignment: .trailing)
            }
          }.accessibilityElement(children: .combine)
            .accessibilityLabel(
              "\(charge.label), \(Formatting.charge(charge)), \(charge.interface.rawValue) interface"
            )
        }
        if let banked = account.banked {
          GridRow {
            Text("Banked").lineLimit(1).help("Banked").foregroundStyle(HR.secondary).frame(
              width: 78, alignment: .leading)
            Text(bankedText).lineLimit(1).truncationMode(.tail).help(bankedText)
              .gridCellColumns(3).frame(width: 298, alignment: .leading)
          }.accessibilityElement(children: .combine)
            .accessibilityLabel("Banked, \(bankedText), \(banked.interface.rawValue) interface")
        }
      }
      .font(HR.font(13)).monospacedDigit()
      .foregroundStyle(quiet ? HR.secondary : HR.ink)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .contain).accessibilityLabel(item.name)
  }

  private func limitRow(_ limit: FeedAccount.limitsPayloadPayload) -> some View {
    let label = Presentation.limitLabel(limit, in: account)
    let left = limit.percentLeft
    let out = left == 0 && !limit.unlimited
    let tight = !out && (limit.runsOutAt != nil || (left.map { $0 <= 20 } ?? false))
    let value =
      limit.unlimited
      ? "Unlimited" : limit.notStarted ? "Not started" : Formatting.barePercent(left)
    let time =
      limit.notStarted
      ? ""
      : Formatting.date(milliseconds: limit.resetsAt).map { Formatting.when($0, now: model.now) }
        ?? ""
    return GridRow {
      Text(label).lineLimit(1).truncationMode(.tail).help(label).foregroundStyle(HR.secondary)
        .padding(.leading, limit.part ? 10 : 0).frame(width: 78, alignment: .leading)
      RoomBar(
        left: left, unlimited: limit.unlimited, quiet: quiet, projected: limit.runsOutAt != nil
      )
      .frame(width: 156)
      Text(value).font(HR.font(13)).foregroundStyle(
        quiet
          ? HR.secondary
          : out ? HR.danger : tight ? HR.warning : left == nil ? HR.secondary : HR.ink
      )
      .fixedSize().frame(width: 44, alignment: .trailing)
      Text(time).font(HR.font(12)).foregroundStyle(out && !quiet ? HR.danger : HR.secondary)
        .frame(width: 74, alignment: .trailing)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "\(label), \(value)\(left == nil || limit.unlimited ? "" : " left"), \(limit.resetWords == .cycle_end ? "cycle ends" : "resets") \(time.isEmpty ? "Unknown" : time), \(limit.interface.rawValue) interface"
    )
  }

  private var bankedText: String {
    guard let banked = account.banked else { return "Unknown" }
    guard let count = banked.count else { return "Unknown" }
    if count == 0 { return "None" }
    let suffix =
      Formatting.date(milliseconds: banked.expiries.first).map {
        " · next expires \(Formatting.when($0, now: model.now))"
      } ?? ""
    return Formatting.inventory(count, unit: banked.unit) + suffix
  }
}

extension SourceState {
  var label: String {
    switch self {
    case .connected: "Connected"
    case .offline: "Offline"
    case .signedOut: "Signed out"
    case .needsUpdate: "Needs update"
    case .noData: "Starting"
    }
  }
}

private func displayLabel(_ label: String) -> String {
  guard label.contains(".") || label.contains("_") else { return label }
  return label.replacingOccurrences(of: ".", with: " ")
    .replacingOccurrences(of: "_", with: " ").capitalized
}
