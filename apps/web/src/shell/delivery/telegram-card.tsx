import { useId, useState } from "react";

import { api, ApiError, type ChannelPatch, type ChannelView, type FoundChat } from "../../api.ts";
import { Button } from "../../ui/button.tsx";
import { PasswordField } from "../../ui/password-field.tsx";
import { Section, SwitchRow } from "../settings-rows.tsx";
import { ChannelPanel } from "./channel-panel.tsx";
import { FormFold } from "./form-parts.tsx";
import { chatTypeWord, problemText, saveProblem } from "./status.ts";

const findProblem = "Headroom could not look up chats. Check the token and try again.";

interface Lookup {
  readonly chats: readonly FoundChat[];
}

/** The inline form that sets up Telegram, or changes it. With a channel, an empty token keeps the current one. */
function TelegramForm(props: {
  readonly channel: ChannelView | null;
  readonly open: boolean;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const { channel } = props;
  const group = useId();
  const [token, setToken] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [identity, setIdentity] = useState(false);
  const [finding, setFinding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanToken = token.trim();
  const canFind = cleanToken !== "" || channel !== null;
  const chatId = typed.trim() !== "" ? typed.trim() : (picked ?? "");
  const chatTitle =
    typed.trim() !== "" ? undefined : lookup?.chats.find((chat) => chat.id === picked)?.title;
  const canSave =
    channel === null ? cleanToken !== "" && chatId !== "" : cleanToken !== "" || chatId !== "";

  const find = (): void => {
    setError(null);
    setFinding(true);
    const source = cleanToken !== "" ? { botToken: cleanToken } : { channelId: channel?.id ?? "" };
    api
      .findChats(source)
      .then((found) => {
        setLookup({ chats: found.chats });
        setPicked(found.chats[0]?.id ?? null);
        return undefined;
      })
      .catch((cause: unknown) =>
        setError(problemText(cause instanceof ApiError ? cause.code : null, findProblem)),
      )
      .finally(() => setFinding(false));
  };

  const save = (): void => {
    setError(null);
    setSaving(true);
    const run =
      channel === null
        ? api.createChannel({
            type: "telegram",
            botToken: cleanToken,
            chatId,
            ...(chatTitle === undefined ? {} : { chatTitle }),
            includeIdentity: identity,
          })
        : api.updateChannel(channel.id, telegramPatch());
    run
      .then(() => props.onDone())
      .catch((cause: unknown) =>
        setError(problemText(cause instanceof ApiError ? cause.code : null, saveProblem)),
      )
      .finally(() => setSaving(false));
  };
  const telegramPatch = (): ChannelPatch => ({
    ...(cleanToken === "" ? {} : { botToken: cleanToken }),
    ...(chatId === "" ? {} : { chatId }),
    ...(chatId === "" || chatTitle === undefined ? {} : { chatTitle }),
  });

  return (
    <FormFold
      open={props.open}
      busy={saving}
      error={error}
      canSave={canSave}
      onSave={save}
      onCancel={props.onCancel}
    >
      <PasswordField
        label="Bot Token"
        description="Create a bot with @BotFather and paste its token."
        value={token}
        autoComplete="off"
        placeholder={channel === null ? undefined : "Leave empty to keep the current token"}
        onChange={(event) => setToken(event.currentTarget.value)}
      />
      <div className="dl-chat">
        <div className="dl-chat-head">
          <span className="dl-label">Chat</span>
          <Button size="sm" busy={finding} busyLabel="Finding" disabled={!canFind} onClick={find}>
            Find Chat
          </Button>
        </div>
        <span className="muted dl-note">Send your bot a message first, then press Find Chat.</span>
        {lookup === null ? null : lookup.chats.length === 0 ? (
          <span className="muted dl-note">
            No chats yet. Send your bot a message and try again.
          </span>
        ) : (
          <fieldset className="dl-chats">
            <legend className="sr">Chat</legend>
            {lookup.chats.map((chat) => (
              <label key={chat.id} className="dl-chat-row">
                <input
                  type="radio"
                  name={group}
                  checked={typed.trim() === "" && picked === chat.id}
                  onChange={() => {
                    setPicked(chat.id);
                    setTyped("");
                  }}
                />
                <span>{chat.title}</span>
                <span className="muted">{chatTypeWord(chat.type)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="field">
          <label htmlFor={`${group}-id`}>Enter Chat ID</label>
          <input
            id={`${group}-id`}
            value={typed}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
        </div>
      </div>
      {/* A set-up channel has its own switch above the form. */}
      {channel === null ? (
        <SwitchRow
          title="Include Account Email"
          note="Adds the email or login of each account."
          checked={identity}
          onChange={setIdentity}
        />
      ) : null}
    </FormFold>
  );
}

/** Telegram: a Set Up row, or the channel with its controls. */
export function TelegramCard(props: {
  readonly channel: ChannelView | null;
  readonly reload: () => void;
}) {
  const { channel, reload } = props;
  const [form, setForm] = useState({ open: false, key: 0 });
  const open = (): void => setForm((current) => ({ open: true, key: current.key + 1 }));
  const close = (): void => setForm((current) => ({ ...current, open: false }));
  return (
    <Section>
      {channel === null ? (
        <div className="srow">
          <span className="sbody">
            <b>Telegram</b>
            <span className="muted">Send notices to a Telegram chat.</span>
          </span>
          <Button size="sm" onClick={open} disabled={form.open}>
            Set Up
          </Button>
        </div>
      ) : (
        <ChannelPanel
          channel={channel}
          title="Telegram"
          reload={reload}
          actions={
            <Button size="sm" variant="quiet" onClick={open}>
              Change
            </Button>
          }
        />
      )}
      <TelegramForm
        key={`${channel?.id ?? "new"}-${form.key}`}
        channel={channel}
        open={form.open}
        onCancel={close}
        onDone={() => {
          close();
          reload();
        }}
      />
    </Section>
  );
}
