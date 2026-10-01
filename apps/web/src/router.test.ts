import { describe, expect, test } from "bun:test";

import { href, parseRoute } from "./router.ts";

describe("router", () => {
  test("parses hashes", () => {
    expect(parseRoute("")).toEqual({ page: "connections" });
    expect(parseRoute("#/connect")).toEqual({ page: "connect" });
    expect(parseRoute("#/connections/a%20b")).toEqual({ page: "detail", id: "a b" });
    expect(parseRoute("#/reconnect/x")).toEqual({ page: "reconnect", id: "x" });
    expect(parseRoute("#/nope")).toEqual({ page: "connections" });
  });
  test("round-trips", () => {
    expect(parseRoute(href({ page: "detail", id: "a b" }))).toEqual({ page: "detail", id: "a b" });
  });
});
