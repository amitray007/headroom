import { useState } from "react";

import type { NotificationChannelType } from "@headroom/core/contracts";

import { ErrorNotice } from "../../ui/error-notice.tsx";
import { SlideSwap } from "../../ui/slide-swap.tsx";
import { Sk } from "../../ui/skeleton.tsx";
import { Section } from "../settings-rows.tsx";
import { DestinationCards, destinations } from "./destination-cards.tsx";
import { DestinationPanel } from "./destination-panel.tsx";
import { useChannels } from "./use-channels.ts";
import "./delivery.css";

function Waiting() {
  return (
    <div className="cards dl-cards">
      {destinations.map((type) => (
        <div key={type} className="card">
          <Sk width={90} height={20} />
          <Sk width={64} height={12} />
        </div>
      ))}
    </div>
  );
}

/** Where notices go. Press Telegram or Webhook to set it up or change it. What is sent follows the Notifications tab. */
export function ChannelsTab() {
  const { status, channels, reload } = useChannels();
  const [retrying, setRetrying] = useState(false);
  const [selected, setSelected] = useState<NotificationChannelType | null>(null);
  const retry = (): void => {
    setRetrying(true);
    reload();
    setTimeout(() => setRetrying(false), 600);
  };
  if (status === "failed") {
    return (
      <Section>
        <ErrorNotice inline busy={retrying} onRetry={retry}>
          Headroom could not load your channels.
        </ErrorNotice>
      </Section>
    );
  }
  if (status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading channels">
        <Waiting />
      </div>
    );
  }
  return (
    <Section>
      <DestinationCards channels={channels} selected={selected} onSelect={setSelected} />
      <SlideSwap swapKey={selected ?? "none"} direction="swap">
        {selected === null ? null : (
          <DestinationPanel
            key={selected}
            type={selected}
            channel={channels.find((entry) => entry.type === selected) ?? null}
            reload={reload}
          />
        )}
      </SlideSwap>
    </Section>
  );
}
