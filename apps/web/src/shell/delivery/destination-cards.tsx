import type { NotificationChannelType } from "@headroom/core/contracts";

import type { ChannelView } from "../../api.ts";
import { DestinationMark } from "../../icons.tsx";
import { useNow } from "../../lib/now.ts";
import { cx } from "../../ui/cx.ts";
import { destinationName, destinationState } from "./status.ts";

export const destinations: readonly NotificationChannelType[] = ["telegram", "webhook"];

function DestinationCard(props: {
  readonly type: NotificationChannelType;
  readonly channel: ChannelView | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const now = useNow();
  const state = destinationState(props.channel, now);
  return (
    <button type="button" className="card" aria-pressed={props.selected} onClick={props.onSelect}>
      <span className="head">
        <DestinationMark type={props.type} size={24} />
        {destinationName(props.type)}
      </span>
      <span className="dl-state">
        <span className={cx("dl-dot", state.tone)} aria-hidden="true" />
        <span className="dl-state-word">{state.word}</span>
        {state.detail === null ? null : (
          <span className="muted dl-state-detail">{state.detail}</span>
        )}
      </span>
    </button>
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
