import { describe, expect, test } from "bun:test";

import type { ExchangeRatesPayload } from "../api.ts";
import { createExchangeRatesStore } from "./exchange-rates.ts";

const payload: ExchangeRatesPayload = {
  base: "USD",
  date: "2026-10-02",
  fetchedAt: 1_700_000_000_000,
  perUsd: { USD: 1, EUR: 0.89087, INR: 96.32, XXX: 3 },
  error: null,
};

function visibility() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: "hidden" as string,
    addEventListener: (_type: "visibilitychange", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "visibilitychange", listener: () => void) =>
      listeners.delete(listener),
    show(this: { visibilityState: string }) {
      this.visibilityState = "visible";
      for (const listener of listeners) listener();
    },
    count: () => listeners.size,
  };
}

function client(results: (() => Promise<ExchangeRatesPayload>)[]) {
  const calls: string[] = [];
  const next = (name: string) => () => {
    calls.push(name);
    const result = results.shift();
    return result ? result() : Promise.reject(new Error("unexpected"));
  };
  return { calls, exchangeRates: next("get"), refreshExchangeRates: next("refresh") };
}

const settle = () => Bun.sleep(0);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("exchange rates store", () => {
  test("starts loading, loads on the first subscriber, keeps supported currencies", async () => {
    const c = client([() => Promise.resolve(payload)]);
    const store = createExchangeRatesStore(c, { visibility: null });
    expect(store.getState().status).toBe("loading");
    expect(c.calls).toEqual([]);
    const stop = store.subscribe(() => undefined);
    const stop2 = store.subscribe(() => undefined);
    await settle();
    expect(c.calls).toEqual(["get"]);
    const state = store.getState();
    expect(state.status).toBe("ready");
    expect(state.perUsd).toEqual({ USD: 1, EUR: 0.89087, INR: 96.32 });
    expect(state.date).toBe("2026-10-02");
    expect(state.fetchedAt).toBe(payload.fetchedAt);
    stop();
    stop2();
  });

  test("a failed first load is failed with an error and no rates", async () => {
    const store = createExchangeRatesStore(client([() => Promise.reject(new Error("down"))]), {
      visibility: null,
    });
    const stop = store.subscribe(() => undefined);
    await settle();
    expect(store.getState()).toMatchObject({
      status: "failed",
      perUsd: null,
      error: "Could not reach the server.",
    });
    stop();
  });

  test("a server that has no rates yet is failed and carries its error", async () => {
    const c = client([
      () =>
        Promise.resolve({
          ...payload,
          date: null,
          fetchedAt: null,
          perUsd: null,
          error: "The rate service could not be reached.",
        }),
    ]);
    const store = createExchangeRatesStore(c, { visibility: null });
    const stop = store.subscribe(() => undefined);
    await settle();
    expect(store.getState()).toMatchObject({
      status: "failed",
      error: "The rate service could not be reached.",
    });
    stop();
  });

  test("a read after the first shows refreshing meanwhile; a failure keeps the old rates", async () => {
    const gate = deferred<ExchangeRatesPayload>();
    let clock = 0;
    const view = visibility();
    const c = client([
      () => Promise.resolve(payload),
      () => gate.promise,
      () => Promise.reject(new Error("down")),
    ]);
    const store = createExchangeRatesStore(c, { now: () => clock, visibility: view });
    const stop = store.subscribe(() => undefined);
    await settle();
    const seen: string[] = [];
    const stopWatch = store.subscribe(() => seen.push(store.getState().status));
    clock = 60 * 60_000 + 1;
    view.show();
    expect(store.getState().status).toBe("refreshing");
    gate.resolve({ ...payload, date: "2026-10-03", perUsd: { USD: 1, INR: 97 } });
    await settle();
    expect(store.getState()).toMatchObject({ status: "ready", date: "2026-10-03" });
    expect(store.getState().perUsd).toEqual({ USD: 1, INR: 97 });
    clock = 2 * (60 * 60_000 + 1);
    view.show();
    await settle();
    expect(store.getState()).toMatchObject({
      status: "ready",
      error: "Could not reach the server.",
      date: "2026-10-03",
    });
    expect(store.getState().perUsd).toEqual({ USD: 1, INR: 97 });
    expect(seen).toContain("refreshing");
    expect(c.calls).toEqual(["get", "get", "get"]);
    stop();
    stopWatch();
  });

  test("the page returning reads again only after more than an hour", async () => {
    let clock = 0;
    const view = visibility();
    const c = client([
      () => Promise.resolve(payload),
      () => Promise.resolve({ ...payload, date: "2026-10-03" }),
    ]);
    const store = createExchangeRatesStore(c, { now: () => clock, visibility: view });
    const stop = store.subscribe(() => undefined);
    await settle();
    clock = 60 * 60_000;
    view.show();
    await settle();
    expect(c.calls).toEqual(["get"]);
    clock = 60 * 60_000 + 1;
    view.show();
    await settle();
    expect(c.calls).toEqual(["get", "get"]);
    expect(store.getState().date).toBe("2026-10-03");
    stop();
    expect(view.count()).toBe(0);
  });
});
