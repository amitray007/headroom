import HeadroomAPI

public typealias AppFeed = Components.Schemas.AppFeed

public typealias FeedAccount = AppFeed.accountsPayloadPayload
public typealias FeedNotice = AppFeed.noticesPayloadPayload
public typealias NoticeKind = FeedNotice.kindPayload
public typealias FeedCharge = FeedAccount.chargesPayloadPayload
