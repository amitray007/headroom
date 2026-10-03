import { describe, expect, test } from "bun:test";

import { ExchangeRateService } from "./exchange-rates.ts";
import type { Fetch } from "./notify/http.ts";

const good = {
  amount: 1,
  base: "USD",
  date: "2026-10-02",
  rates: {
    AUD: 1.4411,
    BRL: 5.2214,
    CAD: 1.424,
    CHF: 0.82664,
    EUR: 0.89087,
    GBP: 0.75753,
    INR: 96.32,
    JPY: 157.67,
    SGD: 1.2798,
  },
};

const hour = 3_600_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function setup(responses: (() => Response | Promise<Response>)[]) {
  let now = 1_700_000_000_000;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return Promise.resolve(next());
  };
  const service = new ExchangeRateService({ fetch, now: () => new Date(now) });
  return {
    service,
    calls,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

const ok =
  (body: unknown = good) =>
  () =>
    Response.json(body);

describe("exchange rate service", () => {
  test("fetches Frankfurter once and serves USD plus the supported currencies", async () => {
    const h = setup([ok()]);
    const view = await h.service.get();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.url).toBe(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,INR,CAD,AUD,JPY,SGD,CHF,BRL",
    );
    expect(h.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(view).toEqual({
      base: "USD",
      date: "2026-10-02",
      fetchedAt: h.now(),
      perUsd: { USD: 1, ...good.rates },
      error: null,
    });
    await h.service.get();
    expect(h.calls).toHaveLength(1);
  });

  test("reads older than 24 hours fetch again; younger ones do not", async () => {
    const h = setup([ok(), ok({ ...good, date: "2026-10-03" })]);
    await h.service.get();
    h.advance(24 * hour - 1);
    expect((await h.service.get()).date).toBe("2026-10-02");
    h.advance(1);
    expect((await h.service.get()).date).toBe("2026-10-03");
    expect(h.calls).toHaveLength(2);
  });

  test("a failed fetch keeps the last good rates and records the error", async () => {
    const h = setup([ok(), () => new Response("nope", { status: 503 }), ok()]);
    const first = await h.service.get();
    h.advance(25 * hour);
    const failed = await h.service.get();
    expect(failed.perUsd).toEqual(first.perUsd);
    expect(failed.fetchedAt).toBe(first.fetchedAt);
    expect(failed.error).toBe("The rate service answered with status 503.");
    h.advance(61_000);
    const healed = await h.service.get();
    expect(healed.error).toBeNull();
    expect(healed.fetchedAt).toBe(h.now());
  });

  test("failure before any success leaves rates null, and reads do not hammer the service", async () => {
    const h = setup([() => Response.json({ base: "EUR" }), ok()]);
    const view = await h.service.get();
    expect(view).toEqual({
      base: "USD",
      date: null,
      fetchedAt: null,
      perUsd: null,
      error: "The rate service sent an unexpected response.",
    });
    h.advance(30_000);
    await h.service.get();
    expect(h.calls).toHaveLength(1);
    h.advance(31_000);
    expect((await h.service.get()).perUsd?.["EUR"]).toBe(0.89087);
  });

  test("a response missing a supported currency is rejected whole", async () => {
    const { INR: _inr, ...rates } = good.rates;
    const h = setup([ok({ ...good, rates })]);
    const view = await h.service.get();
    expect(view.perUsd).toBeNull();
    expect(view.error).toBe("The rate service sent no rate for INR.");
  });

  test("rejects zero, negative and non-numeric rates", async () => {
    const views = await Promise.all(
      [0, -1, "96.3"].map((bad) =>
        setup([ok({ ...good, rates: { ...good.rates, INR: bad } })]).service.get(),
      ),
    );
    for (const view of views) expect(view.perUsd).toBeNull();
  });

  test("a network error and a timeout become plain sentences without response text", async () => {
    const network = setup([
      () => {
        throw new TypeError("connect ECONNREFUSED https://secret.example");
      },
    ]);
    expect((await network.service.get()).error).toBe("The rate service could not be reached.");
    const timeout = new ExchangeRateService({
      fetch: () => Promise.reject(new DOMException("slow", "TimeoutError")),
      now: () => new Date(0),
    });
    expect((await timeout.get()).error).toBe("The rate service did not answer in time.");
  });

  test("a hung request is cut off by the timeout", async () => {
    const service = new ExchangeRateService({
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      now: () => new Date(0),
      timeoutMs: 5,
    });
    expect((await service.get()).error).toBe("The rate service did not answer in time.");
  });

  test("forced refresh runs once per 60 seconds and a press inside that returns the current view", async () => {
    const h = setup([ok(), ok({ ...good, date: "2026-10-03" })]);
    await h.service.refresh();
    h.advance(59_999);
    expect((await h.service.refresh()).date).toBe("2026-10-02");
    expect(h.calls).toHaveLength(1);
    h.advance(1);
    expect((await h.service.refresh()).date).toBe("2026-10-03");
    expect(h.calls).toHaveLength(2);
  });

  test("callers that arrive during a fetch share it", async () => {
    const gate = deferred<Response>();
    const calls: number[] = [];
    const service = new ExchangeRateService({
      fetch: () => {
        calls.push(1);
        return gate.promise;
      },
      now: () => new Date(0),
    });
    const both = Promise.all([service.get(), service.refresh()]);
    gate.resolve(Response.json(good));
    const [a, b] = await both;
    expect(calls).toHaveLength(1);
    expect(a.perUsd).toEqual(b.perUsd);
  });

  test("start fetches at once and on the timer; stop ends it", async () => {
    let count = 0;
    const service = new ExchangeRateService({
      fetch: () => {
        count += 1;
        return Promise.resolve(Response.json(good));
      },
      now: () => new Date(0),
      maxAgeMs: 20,
    });
    service.start();
    service.start();
    await Bun.sleep(70);
    service.stop();
    const seen = count;
    expect(seen).toBeGreaterThanOrEqual(3);
    await Bun.sleep(50);
    expect(count).toBe(seen);
  });
});
