import { describe, expect, test } from "bun:test";

import { apiTokenKindOf } from "./api-tokens.ts";

describe("apiTokenKindOf", () => {
  test("reads the stored kind, once or twice stringified", () => {
    expect(apiTokenKindOf('{"kind":"agent"}')).toBe("agent");
    expect(apiTokenKindOf(JSON.stringify('{"kind":"agent"}'))).toBe("agent");
    expect(apiTokenKindOf({ kind: "device" })).toBe("device");
  });

  test("anything missing or unreadable is a device", () => {
    for (const metadata of [null, undefined, "", "not json", "{}", '{"kind":"phone"}', 4]) {
      expect(apiTokenKindOf(metadata)).toBe("device");
    }
  });
});
