import { useState } from "react";

import { api, type ChannelPatch, type ChannelView } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { Result } from "../../ui/result.tsx";
import { FlowShell } from "./flow-shell.tsx";
import { botNameOf, testProblem } from "./status.ts";
import { stepperAt, telegramWords, type Stage } from "./steps.ts";
import { TelegramBotStep } from "./telegram-bot-step.tsx";
import { TelegramChatStep, type ChatChoice } from "./telegram-chat-step.tsx";
import { TestStep } from "./test-step.tsx";
import type { ChatSource } from "./use-chats.ts";

interface Picked {
  readonly source: ChatSource;
  readonly username: string;
  /** True when the token was checked in this flow. */
  readonly verified: boolean;
}

/**
 * Set up Telegram: Bot, Chat, Test, Done. With `channel` it changes that channel instead, and its saved bot can
 * stay. The channel is saved only when the owner confirms the test message arrived.
 */
export function TelegramFlow(props: {
  readonly channel: ChannelView | null;
  /** Leave without saving. Only offered when changing a channel. */
  readonly onCancel: (() => void) | null;
  /** The channel was saved: load the list again. */
  readonly onSaved: () => void;
  readonly onDone: () => void;
}) {
  const { channel } = props;
  const [stage, setStage] = useState<Stage>("first");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [chat, setChat] = useState<ChatChoice | null>(null);
  const [identity, setIdentity] = useState(channel?.includeIdentity ?? false);
  const [failed, setFailed] = useState(false);
  const { step, state } = stepperAt(stage, failed);
  const chatName = chat?.title ?? chat?.id ?? "";

  const save = async (): Promise<void> => {
    if (picked === null || chat === null) return;
    const title = chat.title === undefined ? {} : { chatTitle: chat.title };
    if (channel === null) {
      if (picked.source.kind !== "token") return;
      await api.createChannel({
        type: "telegram",
        botToken: picked.source.botToken,
        chatId: chat.id,
        ...title,
        includeIdentity: identity,
      });
    } else {
      const patch: ChannelPatch = {
        ...(picked.source.kind === "token" ? { botToken: picked.source.botToken } : {}),
        chatId: chat.id,
        ...title,
        includeIdentity: identity,
      };
      await api.updateChannel(channel.id, patch);
    }
    props.onSaved();
  };

  const send = async (): Promise<void> => {
    if (picked === null || chat === null) return;
    await api.verifyDelivery(
      picked.source.kind === "token"
        ? { type: "telegram", botToken: picked.source.botToken, chatId: chat.id }
        : { type: "telegram", channelId: picked.source.channelId, chatId: chat.id },
    );
  };

  return (
    <FlowShell type="telegram" words={telegramWords} step={step} state={state} stage={stage}>
      {stage === "first" ? (
        <TelegramBotStep
          keepName={channel === null ? null : botNameOf(channel.label)}
          initial={picked?.source.kind === "token" ? picked.source.botToken : ""}
          onKeep={() => {
            if (channel === null) return;
            setPicked({
              source: { kind: "saved", channelId: channel.id },
              username: botNameOf(channel.label),
              verified: false,
            });
            setStage("second");
          }}
          onVerified={(botToken, username) => {
            setPicked({
              source: { kind: "token", botToken },
              username: `@${username.replace(/^@/, "")}`,
              verified: true,
            });
            setStage("second");
          }}
          onCancel={props.onCancel}
        />
      ) : null}
      {stage === "second" && picked !== null ? (
        <TelegramChatStep
          source={picked.source}
          username={picked.username}
          verified={picked.verified}
          initial={chat}
          onBack={() => setStage("first")}
          onContinue={(next) => {
            setChat(next);
            setStage("test");
          }}
        />
      ) : null}
      {stage === "test" && chat !== null ? (
        <TestStep
          lead={`Send a test message to ${chatName}.`}
          identity={identity}
          onIdentity={setIdentity}
          sendLabel="Send Test Message"
          send={send}
          failureText={(code) => testProblem("telegram", code)}
          okTitle="Test Sent"
          okNote="Check Telegram for the message."
          finishLabel="It Arrived"
          finish={save}
          onFinished={() => setStage("done")}
          onBack={() => setStage("second")}
          onFailed={setFailed}
        />
      ) : null}
      {stage === "done" ? (
        <>
          <Result ok title="Telegram Is Set Up">
            {`Notices will arrive in ${chatName}.`}
          </Result>
          <div className="dl-actions">
            <Button variant="primary" onClick={props.onDone}>
              Done
            </Button>
          </div>
        </>
      ) : null}
    </FlowShell>
  );
}
