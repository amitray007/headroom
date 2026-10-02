import { useId } from "react";

import type { FoundChat } from "../../api.ts";
import { chatTypeWord } from "./status.ts";

/** The chats a bot has heard from, as a radio list. `value` is the chosen chat id, or null for none. */
export function ChatList(props: {
  readonly chats: readonly FoundChat[];
  readonly value: string | null;
  readonly onChange: (chat: FoundChat) => void;
}) {
  const group = useId();
  return (
    <fieldset className="dl-chats">
      <legend className="sr">Chat</legend>
      {props.chats.map((chat) => (
        <label key={chat.id} className="dl-chat-row">
          <input
            type="radio"
            name={group}
            checked={props.value === chat.id}
            onChange={() => props.onChange(chat)}
          />
          <span>{chat.title}</span>
          <span className="muted">{chatTypeWord(chat.type)}</span>
        </label>
      ))}
    </fieldset>
  );
}
