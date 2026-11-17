import { clearRead, loadRead } from "@headroom/view-model/notifications";

/** Most ids one write may carry; the server refuses more. */
const chunk = 500;
const pollMs = 60_000;

export interface NoticeReadClient {
  noticeReads: () => Promise<{ ids: string[] }>;
  setNoticeRead: (ids: string[], read: boolean) => Promise<{ ids: string[] }>;
}

/** The browser storage that held read ids before the server did. */
interface LegacyStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
}

interface NoticeReadState {
  /** Ids marked read. */
  readonly read: ReadonlySet<string>;
  /** True once the first load finished, whether or not it worked. */
  readonly loaded: boolean;
}

export interface NoticeReadStore {
  getState: () => NoticeReadState;
  subscribe: (listener: () => void) => () => void;
  /** Start loading and polling. Call the returned function to stop. */
  attach: () => () => void;
  load: () => Promise<void>;
  mark: (ids: readonly string[], read: boolean) => void;
}

/**
 * The owner's read marks outside React. The first load moves any ids this browser saved before the
 * server kept them, then clears them. `mark` shows the change at once and sends it; a failed send
 * loads the server's set again. Sends run one after another.
 */
export function createNoticeReadStore(
  client: NoticeReadClient,
  storage: LegacyStorage | null,
): NoticeReadStore {
  let state: NoticeReadState = { read: new Set(), loaded: false };
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let attached = 0;
  const listeners = new Set<() => void>();
  const set = (next: NoticeReadState): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  const load = async (): Promise<void> => {
    const legacy = storage === null ? [] : [...loadRead(storage)];
    try {
      let ids = (await client.noticeReads()).ids;
      for (let at = 0; at < legacy.length; at += chunk) {
        // eslint-disable-next-line no-await-in-loop -- the chunks are sent in order
        ids = (await client.setNoticeRead(legacy.slice(at, at + chunk), true)).ids;
      }
      if (legacy.length > 0 && storage !== null) clearRead(storage);
      // A server answer must not undo a change still on its way out.
      if (pending === 0) set({ read: new Set(ids), loaded: true });
      else if (!state.loaded) set({ ...state, loaded: true });
    } catch {
      // Without the server, this browser's own old marks still count, and nothing is cleared.
      if (!state.loaded) set({ read: new Set([...state.read, ...legacy]), loaded: true });
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach() {
      attached += 1;
      if (attached === 1) {
        void load();
        timer = setInterval(() => void load(), pollMs);
      }
      return () => {
        attached -= 1;
        if (attached === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    load,
    mark(ids, read) {
      const changed = [...new Set(ids)].filter((id) => state.read.has(id) !== read);
      if (changed.length === 0) return;
      const next = new Set(state.read);
      for (const id of changed) {
        if (read) next.add(id);
        else next.delete(id);
      }
      set({ ...state, read: next });
      pending += 1;
      const send = async (): Promise<void> => {
        let answer: readonly string[] | null = null;
        try {
          for (let at = 0; at < changed.length; at += chunk) {
            // eslint-disable-next-line no-await-in-loop -- the chunks are sent in order
            answer = (await client.setNoticeRead(changed.slice(at, at + chunk), read)).ids;
          }
        } catch {
          answer = null;
        }
        pending -= 1;
        if (answer === null) await load();
        else if (pending === 0) set({ read: new Set(answer), loaded: true });
      };
      queue = queue.then(send);
    },
  };
}
