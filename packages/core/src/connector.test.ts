import { describe, expect, test } from "bun:test";

import {
  classified,
  classifyUnknown,
  ConnectorError,
  nextStepPayloadSchema,
  submitInputSchema,
} from "./connector.ts";

describe("connector contract helpers", () => {
  test("classified carries the canonical class", () => {
    expect(classified("rate_limited", "slow down", 5000)).toEqual({
      category: "rate_limited",
      class: "transient",
      message: "slow down",
      retryAfterMs: 5000,
    });
    expect(classified("authentication_required", "401").class).toBe("definitive");
  });

  test("unknown errors are transient so they never force a reconnect", () => {
    expect(classifyUnknown(new Error("boom")).class).toBe("transient");
    expect(
      classifyUnknown(new ConnectorError("identity_mismatch", "different account")).class,
    ).toBe("definitive");
  });

  test("next step payloads reject secrets-shaped and malformed data", () => {
    expect(
      nextStepPayloadSchema.safeParse({
        kind: "device_code",
        verificationUrl: "not a url",
        userCode: "X",
        expiresAt: 1,
      }).success,
    ).toBe(false);
    expect(nextStepPayloadSchema.safeParse({ kind: "select_account", options: [] }).success).toBe(
      false,
    );
    expect(
      nextStepPayloadSchema.safeParse({
        kind: "paste_file",
        expectedFileName: "auth.json",
        hint: "",
      }).success,
    ).toBe(true);
  });

  test("submit inputs are bounded", () => {
    expect(submitInputSchema.safeParse({ kind: "code", value: "" }).success).toBe(false);
    expect(
      submitInputSchema.safeParse({ kind: "file", contents: "x".repeat(1_048_577) }).success,
    ).toBe(false);
    expect(submitInputSchema.safeParse({ kind: "selection", id: "team-1" }).success).toBe(true);
  });
});
