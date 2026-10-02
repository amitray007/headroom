import { describe, expect, test } from "bun:test";

import { href, isBareRoot, parseRoute, restoreView, viewOf } from "./router.ts";

describe("router", () => {
  test("parses hashes", () => {
    expect(parseRoute("")).toEqual({ page: "overview" });
    expect(parseRoute("#/")).toEqual({ page: "overview" });
    expect(parseRoute("#/detailed")).toEqual({ page: "detailed" });
    expect(parseRoute("#/compare")).toEqual({ page: "compare" });
    expect(parseRoute("#/timeline")).toEqual({ page: "timeline" });
    expect(parseRoute("#/connect")).toEqual({ page: "connect" });
    expect(parseRoute("#/reconnect/x")).toEqual({ page: "reconnect", id: "x" });
    expect(parseRoute("#/dev/ui")).toEqual({ page: "gallery" });
  });
  test("unknown and retired hashes show the Overview", () => {
    expect(parseRoute("#/nope")).toEqual({ page: "overview" });
    expect(parseRoute("#/connections/abc")).toEqual({ page: "overview" });
    expect(parseRoute("#/account")).toEqual({ page: "overview" });
  });
  test("round-trips", () => {
    expect(parseRoute(href({ page: "reconnect", id: "a b" }))).toEqual({
      page: "reconnect",
      id: "a b",
    });
    for (const page of [
      "overview",
      "detailed",
      "compare",
      "timeline",
      "connect",
      "gallery",
    ] as const) {
      expect(parseRoute(href({ page }))).toEqual({ page });
    }
  });
  test("viewOf names the view pages only", () => {
    expect(viewOf({ page: "compare" })).toBe("compare");
    expect(viewOf({ page: "connect" })).toBeNull();
    expect(viewOf({ page: "reconnect", id: "x" })).toBeNull();
  });
  test("only the bare root counts as no explicit view", () => {
    expect([isBareRoot(""), isBareRoot("#"), isBareRoot("#/")]).toEqual([true, true, true]);
    expect(isBareRoot("#/detailed")).toBe(false);
    expect(isBareRoot("#/nope")).toBe(false);
  });
});

function run(hash: string, remembered: Parameters<typeof restoreView>[2]): string[] {
  const calls: string[] = [];
  restoreView(
    { hash, pathname: "/", search: "?a=1" },
    { replaceState: (_state, _title, url) => void calls.push(String(url)) },
    remembered,
  );
  return calls;
}

describe("restoreView", () => {
  test("redirects the bare root to the remembered view", () => {
    expect(run("", "timeline")).toEqual(["/?a=1#/timeline"]);
    expect(run("#/", "detailed")).toEqual(["/?a=1#/detailed"]);
  });
  test("leaves explicit addresses, the Overview and an empty memory alone", () => {
    expect(run("#/compare", "timeline")).toEqual([]);
    expect(run("#/connect", "timeline")).toEqual([]);
    expect(run("#/", "overview")).toEqual([]);
    expect(run("#/", null)).toEqual([]);
  });
});
