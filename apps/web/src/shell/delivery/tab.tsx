import { useState } from "react";

import { ErrorNotice } from "../../ui/error-notice.tsx";
import { Sk } from "../../ui/skeleton.tsx";
import { Section } from "../settings-rows.tsx";
import { TelegramCard } from "./telegram-card.tsx";
import { useChannels } from "./use-channels.ts";
import { WebhookCard } from "./webhook-card.tsx";
import "./delivery.css";

function Waiting() {
  return (
    <>
      {["Telegram", "Webhook"].map((title) => (
        <Section key={title}>
          <div className="srow">
            <span className="sbody">
              <Sk width={90} height={16} />
              <Sk width={190} height={12} />
            </span>
            <Sk width={64} height={28} className="sk-pill sk-control" />
          </div>
        </Section>
      ))}
    </>
  );
}

/** Where notices go: Telegram and a webhook. What is sent follows the Notifications tab. */
export function DeliveryTab() {
  const { status, channels, reload } = useChannels();
  const [retrying, setRetrying] = useState(false);
  const retry = (): void => {
    setRetrying(true);
    reload();
    setTimeout(() => setRetrying(false), 600);
  };
  const find = (type: "telegram" | "webhook") =>
    channels.find((entry) => entry.type === type) ?? null;
  return status === "failed" ? (
    <section className="dsec">
      <ErrorNotice inline busy={retrying} onRetry={retry}>
        Headroom could not load your delivery settings.
      </ErrorNotice>
    </section>
  ) : status === "loading" ? (
    <div aria-busy="true" aria-label="Loading delivery settings">
      <Waiting />
    </div>
  ) : (
    <>
      <TelegramCard channel={find("telegram")} reload={reload} />
      <WebhookCard channel={find("webhook")} reload={reload} />
    </>
  );
}
