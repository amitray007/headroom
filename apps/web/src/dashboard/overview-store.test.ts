import { describe, expect, test } from "bun:test";

import { connection } from "@headroom/view-model/test-fixtures";
import { createOverviewStore } from "./overview-store.ts";

describe("overview store", () => {
  test("loads once on subscribe and keeps the last list when a reload fails", async () => {
    let fail = false;
    const store = createOverviewStore({
      overview: () =>
        fail
          ? Promise.reject(new Error("down"))
          : Promise.resolve({ connections: [connection("claude")], providerOrder: [] }),
    });
    const stop = store.subscribe(() => undefined);
    await store.reload();
    expect(store.getState().connections?.length).toBe(1);
    fail = true;
    await store.reload();
    expect(store.getState()).toEqual({
      connections: [connection("claude")],
      providerOrder: [],
      failed: false,
      stale: true,
    });
    fail = false;
    await store.reload();
    expect(store.getState().stale).toBe(false);
    stop();
  });
  test("an unchanged poll keeps the same list and does not notify", async () => {
    const store = createOverviewStore({
      overview: () => Promise.resolve({ connections: [connection("claude")], providerOrder: [] }),
    });
    await store.reload();
    const first = store.getState();
    let notified = 0;
    const stop = store.subscribe(() => (notified += 1));
    await store.reload();
    expect(store.getState()).toBe(first);
    expect(notified).toBe(0);
    stop();
  });
  test("reports failure only while nothing is loaded", async () => {
    const store = createOverviewStore({ overview: () => Promise.reject(new Error("down")) });
    await store.reload();
    expect(store.getState()).toEqual({
      connections: null,
      providerOrder: [],
      failed: true,
      stale: false,
    });
  });
  test("an applied order shows at once and the next load replaces it", async () => {
    const first = connection("claude");
    const second = connection("codex");
    const store = createOverviewStore({
      overview: () =>
        Promise.resolve({
          connections: [first, second],
          providerOrder: ["claude", "codex"],
        }),
    });
    await store.reload();
    store.applyOrder({
      providers: ["codex", "claude"],
      accounts: { claude: [first.id], codex: [second.id] },
    });
    expect(store.getState().connections?.map((entry) => entry.provider)).toEqual([
      "codex",
      "claude",
    ]);
    expect(store.getState().providerOrder).toEqual(["codex", "claude"]);
    await store.reload();
    expect(store.getState().providerOrder).toEqual(["claude", "codex"]);
  });
});
