import { describe, expect, test } from "bun:test";

import { href, parseRoute } from "./router.ts";

describe("router", () => {
  test("parses hashes", () => {
    expect(parseRoute("")).toEqual({ page: "connections" });
    expect(parseRoute("#/")).toEqual({ page: "connections" });
    expect(parseRoute("#/connect")).toEqual({ page: "connect" });
    expect(parseRoute("#/reconnect/x")).toEqual({ page: "reconnect", id: "x" });
    expect(parseRoute("#/dev/ui")).toEqual({ page: "gallery" });
  });
  test("unknown and retired hashes show the dashboard", () => {
    expect(parseRoute("#/nope")).toEqual({ page: "connections" });
    expect(parseRoute("#/connections/abc")).toEqual({ page: "connections" });
    expect(parseRoute("#/account")).toEqual({ page: "connections" });
  });
  test("round-trips", () => {
    expect(parseRoute(href({ page: "reconnect", id: "a b" }))).toEqual({
      page: "reconnect",
      id: "a b",
    });
    expect(parseRoute(href({ page: "connect" }))).toEqual({ page: "connect" });
    expect(parseRoute(href({ page: "connections" }))).toEqual({ page: "connections" });
    expect(parseRoute(href({ page: "gallery" }))).toEqual({ page: "gallery" });
  });
});
