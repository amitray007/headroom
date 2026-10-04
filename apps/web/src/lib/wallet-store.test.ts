import { describe, expect, test } from "bun:test";

import { emptyBook, type WalletBook } from "@headroom/view-model/wallet";

import type { ServerWallet } from "../api.ts";
import { createWalletStore, type WalletClient } from "./wallet-store.ts";

const server = (extra: Partial<ServerWallet> = {}): ServerWallet => ({
  costs: {},
  topUps: [],
  ...extra,
});

function fakeClient(options: { reject?: (what: string) => Error | null } = {}) {
  const calls: string[] = [];
  const gates: (() => void)[] = [];
  let current = server();
  const run = async (what: string, next: (book: ServerWallet) => ServerWallet) => {
    calls.push(what);
    const error = options.reject?.(what) ?? null;
    if (error !== null) throw error;
    current = next(current);
    return current;
  };
  const client: WalletClient = {
    wallet: () => Promise.resolve(current),
    setCost: (id, cost) => run(`set ${id}`, (b) => ({ ...b, costs: { ...b.costs, [id]: cost } })),
    clearCost: (id) =>
      run(`clear ${id}`, (b) => ({
        ...b,
        costs: Object.fromEntries(Object.entries(b.costs).filter(([key]) => key !== id)),
      })),
    addTopUp: (input) =>
      run(`add ${input.connectionId}`, (b) => ({
        ...b,
        topUps: [{ id: `s${b.topUps.length + 1}`, source: "owner", ...input }, ...b.topUps],
      })),
    updateTopUp: (id, update) =>
      run(`update ${id}`, (b) => ({
        ...b,
        topUps: b.topUps.map((t) => (t.id === id ? { ...t, ...update } : t)),
      })),
    removeTopUp: (id) =>
      run(`remove ${id}`, (b) => ({ ...b, topUps: b.topUps.filter((t) => t.id !== id) })),
  };
  return { client, calls, gates };
}

describe("wallet store", () => {
  test("loads the server book; a failed load is flagged", async () => {
    const { client } = fakeClient();
    const store = createWalletStore(client);
    expect(store.getState().loaded).toBe(false);
    await store.load();
    expect(store.getState()).toMatchObject({ loaded: true, loadFailed: false });
    const down = createWalletStore({ ...client, wallet: () => Promise.reject(new Error("down")) });
    await down.load();
    expect(down.getState()).toMatchObject({ loaded: true, loadFailed: true });
  });
  test("mutations take the returned book; null clears a cost", async () => {
    const { client, calls } = fakeClient();
    const store = createWalletStore(client);
    await store.setCost("a", { kind: "free" });
    expect(store.getState().costs).toEqual({ a: { kind: "free" } });
    await store.addTopUp({
      connectionId: "a",
      date: "2026-10-01",
      kind: "free",
      price: null,
      credits: null,
      note: null,
      expiresOn: null,
      expiryAlertDays: null,
    });
    expect(store.getState().topUps.map((t) => t.id)).toEqual(["s1"]);
    await store.updateTopUp("s1", {
      date: "2026-10-02",
      kind: "free",
      price: null,
      credits: 5,
      note: "Bonus",
      expiresOn: "2026-11-01",
      expiryAlertDays: 7,
    });
    expect(store.getState().topUps[0]).toMatchObject({
      id: "s1",
      connectionId: "a",
      source: "owner",
      date: "2026-10-02",
      credits: 5,
      expiryAlertDays: 7,
    });
    await store.removeTopUp("s1");
    await store.setCost("a", null);
    expect(store.getState()).toMatchObject({ costs: {}, topUps: [] });
    expect(calls).toEqual(["set a", "add a", "update s1", "remove s1", "clear a"]);
  });
  test("a refused mutation rejects and leaves the state alone", async () => {
    const { client } = fakeClient({
      reject: (what) => (what === "set b" ? new Error("no") : null),
    });
    const store = createWalletStore(client);
    await store.setCost("a", { kind: "free" });
    const before = store.getState();
    expect(await store.setCost("b", { kind: "free" }).catch(() => "rejected")).toBe("rejected");
    expect(store.getState()).toBe(before);
    await store.setCost("c", { kind: "free" });
    expect(Object.keys(store.getState().costs)).toEqual(["a", "c"]);
  });
  test("mutations run one after another", async () => {
    const order: string[] = [];
    const release: (() => void)[] = [];
    const slow = (name: string) =>
      new Promise<ServerWallet>((done) => {
        order.push(`start ${name}`);
        release.push(() => {
          order.push(`end ${name}`);
          done(server());
        });
      });
    const { client } = fakeClient();
    const store = createWalletStore({
      ...client,
      setCost: (id) => slow(id),
      removeTopUp: (id) => slow(id),
    });
    const first = store.setCost("a", { kind: "free" });
    const second = store.removeTopUp("t");
    await Bun.sleep(0);
    expect(order).toEqual(["start a"]);
    release[0]?.();
    await first;
    await Bun.sleep(0);
    release[1]?.();
    await second;
    expect(order).toEqual(["start a", "end a", "start t", "end t"]);
  });
  test("Demo Mode edits stay in memory", () => {
    const store = createWalletStore(fakeClient().client);
    let made = 0;
    const make = (): WalletBook => {
      made += 1;
      return emptyBook;
    };
    expect(store.demo("1:100", make)).toBe(emptyBook);
    expect(store.demo("1:100", make)).toBe(emptyBook);
    expect(made).toBe(1);
    store.setDemo("1:100", { ...emptyBook, displayCurrency: "GBP" });
    expect(store.demo("1:100", make).displayCurrency).toBe("GBP");
    expect(store.demo("2:200", make)).toBe(emptyBook);
    expect(made).toBe(2);
  });
});
