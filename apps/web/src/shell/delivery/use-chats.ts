import { useEffect, useState } from "react";

import { api, ApiError, type FoundChat } from "../../api.ts";

/** Where Telegram chats are looked up: a token the owner typed, or the token of a saved channel. */
export type ChatSource =
  | { readonly kind: "token"; readonly botToken: string }
  | { readonly kind: "saved"; readonly channelId: string };

const everyMs = 3000;
const stopAfterMs = 2 * 60_000;

/**
 * Looks for chats the bot has heard from, every 3 seconds while `active`, and stops after 2 minutes.
 * `again` starts a new round. The list only grows or refreshes; a failed lookup keeps the last list.
 */
export function useChats(
  source: ChatSource,
  active: boolean,
): {
  readonly chats: readonly FoundChat[];
  readonly stopped: boolean;
  readonly problem: "rejected" | "failed" | null;
  readonly again: () => void;
} {
  const [chats, setChats] = useState<readonly FoundChat[]>([]);
  const [stopped, setStopped] = useState(false);
  const [problem, setProblem] = useState<"rejected" | "failed" | null>(null);
  const [round, setRound] = useState(0);
  const key = source.kind === "token" ? `t:${source.botToken}` : `s:${source.channelId}`;

  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const body =
      source.kind === "token" ? { botToken: source.botToken } : { channelId: source.channelId };
    const tick = async (): Promise<void> => {
      try {
        const found = await api.findChats(body);
        if (!live) return;
        setChats(found.chats);
        setProblem(null);
      } catch (cause) {
        if (!live) return;
        const rejected = cause instanceof ApiError && cause.code === "telegram_token_rejected";
        setProblem(rejected ? "rejected" : "failed");
        if (rejected) {
          setStopped(true);
          return;
        }
      }
      if (Date.now() - started >= stopAfterMs) {
        setStopped(true);
        return;
      }
      timer = setTimeout(() => void tick(), everyMs);
    };
    setStopped(false);
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The source is read through `key`, so a new object with the same token does not restart the lookup.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, round]);

  return { chats, stopped, problem, again: () => setRound((count) => count + 1) };
}
