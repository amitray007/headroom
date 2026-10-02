import { api, type ChannelView } from "../../api.ts";
import { useLoad } from "../../lib/load.ts";

/** The delivery channels, loaded when the tab opens. `reload` fetches again; the old list stays while it does. */
export function useChannels(): {
  readonly status: "loading" | "ready" | "failed";
  readonly channels: readonly ChannelView[];
  readonly reload: () => void;
} {
  const loaded = useLoad(() => api.channels(), "delivery-channels");
  const status = loaded.data !== null ? "ready" : loaded.error !== null ? "failed" : "loading";
  return { status, channels: loaded.data?.channels ?? [], reload: loaded.reload };
}
