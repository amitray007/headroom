import { describe, expect, test } from "bun:test";

import { readKey } from "@headroom/view-model/notifications";

import { createNoticeReadStore, type NoticeReadClient } from "./notice-read-store.ts";

function server(
  initial: string[] = [],
  options: { failWrites?: boolean; failReads?: boolean } = {},
) {
  const ids = new Set(initial);
  const writes: { ids: string[]; read: boolean }[] = [];
  const release: (() => void)[] = [];
  const gate = options.failWrites === true ? null : { hold: false };
  const client: NoticeReadClient = {
    noticeReads: () =>
      options.failReads === true
        ? Promise.reject(new Error("down"))
        : Promise.resolve({ ids: [...ids].toSorted() }),
    setNoticeRead: async (list, read) => {
      writes.push({ ids: list, read });
      if (options.failWrites === true) throw new Error("down");
      if (gate?.hold === true) await new Promise<void>((resolve) => release.push(resolve));
      for (const id of list) {
        if (read) ids.add(id);
        else ids.delete(id);
      }
      return { ids: [...ids].toSorted() };
    },
  };
  return { client, writes, ids, gate, release };
}

function storage(saved?: string) {
  const data = new Map<string, string>(saved === undefined ? [] : [[readKey, saved]]);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("notice read store", () => {
  test("loads the server set", async () => {
    const s = server(["a", "b"]);
    const store = createNoticeReadStore(s.client, storage());
    expect(store.getState().loaded).toBe(false);
    await store.load();
    expect(store.getState().loaded).toBe(true);
    expect([...store.getState().read]).toEqual(["a", "b"]);
  });

  test("moves ids saved in this browser to the server once, then clears them", async () => {
    const s = server(["x"]);
    const local = storage('["a","b",1]');
    const store = createNoticeReadStore(s.client, local);
    await store.load();
    expect(s.writes).toEqual([{ ids: ["a", "b"], read: true }]);
    expect([...store.getState().read]).toEqual(["a", "b", "x"]);
    expect(local.data.has(readKey)).toBe(false);
    await store.load();
    expect(s.writes).toHaveLength(1);
  });

  test("keeps the saved ids when the server cannot be reached, and shows them as read", async () => {
    const s = server([], { failReads: true });
    const local = storage('["a"]');
    const store = createNoticeReadStore(s.client, local);
    await store.load();
    expect(store.getState().loaded).toBe(true);
    expect([...store.getState().read]).toEqual(["a"]);
    expect(local.data.has(readKey)).toBe(true);
  });

  test("marking shows at once and then matches the server's answer", async () => {
    const s = server(["a"]);
    const store = createNoticeReadStore(s.client, null);
    await store.load();
    store.mark(["b", "c", "a"], true);
    expect([...store.getState().read].toSorted()).toEqual(["a", "b", "c"]);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.writes).toEqual([{ ids: ["b", "c"], read: true }]);
    expect([...s.ids].toSorted()).toEqual(["a", "b", "c"]);
    store.mark(["b"], false);
    expect(store.getState().read.has("b")).toBe(false);
    store.mark(["b"], false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.writes).toHaveLength(2);
  });

  test("a poll that lands while a mark is in flight does not undo it", async () => {
    const s = server();
    s.gate!.hold = true;
    const store = createNoticeReadStore(s.client, null);
    await store.load();
    store.mark(["a"], true);
    await store.load();
    expect(store.getState().read.has("a")).toBe(true);
    for (const release of s.release) release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...store.getState().read]).toEqual(["a"]);
  });

  test("a failed write puts the server's set back", async () => {
    const s = server(["a"], { failWrites: true });
    const store = createNoticeReadStore(s.client, null);
    await store.load();
    store.mark(["b"], true);
    expect(store.getState().read.has("b")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...store.getState().read]).toEqual(["a"]);
  });

  test("notifies subscribers and stops polling when the last view detaches", async () => {
    const s = server(["a"]);
    const store = createNoticeReadStore(s.client, null);
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    const detach = store.attach();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBeGreaterThan(0);
    detach();
    off();
  });
});
