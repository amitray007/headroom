import { useState } from "react";

import type { NotificationChannelType } from "@headroom/core/contracts";

import type { ChannelView } from "../../api.ts";
import { ChannelPanel } from "./channel-panel.tsx";
import { TelegramFlow } from "./telegram-flow.tsx";
import { WebhookFlow } from "./webhook-flow.tsx";

/**
 * What opens under the cards for one destination: the setup flow when it is not set up (or the owner is changing
 * it), otherwise its settings. The flow stays open through its last step even after the channel is saved.
 */
export function DestinationPanel(props: {
  readonly type: NotificationChannelType;
  readonly channel: ChannelView | null;
  readonly reload: () => void;
}) {
  const { type, channel, reload } = props;
  const [flowing, setFlowing] = useState(channel === null);
  // A removed channel starts the flow again, and the flow then outlives the save that follows.
  if (channel === null && !flowing) setFlowing(true);
  if (channel !== null && !flowing) {
    return <ChannelPanel channel={channel} reload={reload} onChange={() => setFlowing(true)} />;
  }
  const flow = {
    channel,
    onCancel: channel === null ? null : () => setFlowing(false),
    onSaved: reload,
    onDone: () => setFlowing(false),
  };
  return type === "telegram" ? <TelegramFlow {...flow} /> : <WebhookFlow {...flow} />;
}
