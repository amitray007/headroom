import type { NotificationChannelType } from "@headroom/core/contracts";

import type { ChannelView } from "../../api.ts";
import { AlertIcon, DestinationMark } from "../../icons.tsx";
import { cx } from "../../ui/cx.ts";
import { MarkCard } from "../../ui/mark-card.tsx";
import { VerifiedSeal } from "../../ui/verified-seal.tsx";
import { destinationName, destinationState } from "./status.ts";

export const destinations: readonly NotificationChannelType[] = ["telegram", "webhook"];

function DestinationCard(props: {
  readonly type: NotificationChannelType;
  readonly channel: ChannelView | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const state = destinationState(props.channel);
  return (
    <MarkCard
      mark={<DestinationMark type={props.type} size={24} />}
      name={destinationName(props.type)}
      pressed={props.selected}
      onClick={props.onSelect}
      status={
        state.mark === "on" || state.mark === "off" ? (
          <VerifiedSeal tone={state.mark === "on" ? "good" : "muted"} label={state.label} />
        ) : state.mark === "failing" ? (
          <span className="dl-alert" title={state.label}>
            <AlertIcon />
            <span className="sr">{state.label}</span>
          </span>
        ) : undefined
      }
    />
  );
}

/** The two destinations side by side. Press one to open it; press it again to close it. */
export function DestinationCards(props: {
  readonly channels: readonly ChannelView[];
  readonly selected: NotificationChannelType | null;
  readonly onSelect: (type: NotificationChannelType | null) => void;
}) {
  return (
    <div className={cx("cards", "dl-cards", props.selected !== null && "picked")}>
      {destinations.map((type) => (
        <DestinationCard
          key={type}
          type={type}
          channel={props.channels.find((entry) => entry.type === type) ?? null}
          selected={props.selected === type}
          onSelect={() => props.onSelect(props.selected === type ? null : type)}
        />
      ))}
    </div>
  );
}
