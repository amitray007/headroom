import { describe, expect, test } from "bun:test";

import {
  copyText,
  resetOutcome,
  resetOutcomeOfError,
  runAction,
  type ActionPhase,
} from "./action-state.ts";

describe("runAction", () => {
  test("reports pending, then success", async () => {
    const seen: ActionPhase[] = [];
    const result = await runAction(
      () => Promise.resolve(),
      (phase) => seen.push(phase),
    );
    expect(result).toBe("success");
    expect(seen).toEqual(["pending", "success"]);
  });

  test("a rejected action is the failed phase and does not throw", async () => {
    const seen: ActionPhase[] = [];
    const result = await runAction(
      () => Promise.reject(new Error("no")),
      (phase) => seen.push(phase),
    );
    expect(result).toBe("failed");
    expect(seen).toEqual(["pending", "failed"]);
  });
});

describe("copyText", () => {
  test("passes the text to the clipboard", async () => {
    let written = "";
    const result = await copyText("ABCD-1234", (text) => {
      written = text;
      return Promise.resolve();
    });
    expect(result).toBe("copied");
    expect(written).toBe("ABCD-1234");
  });

  test("a refused write is an error", async () => {
    expect(await copyText("x", () => Promise.reject(new Error("denied")))).toBe("error");
  });
});

describe("resetOutcome", () => {
  test("only a certain result is ok or failed; an uncertain reset is never a retry", () => {
    expect(resetOutcome("succeeded")).toBe("ok");
    expect(resetOutcome("failed")).toBe("failed");
    expect(resetOutcome("uncertain")).toBe("unknown");
    expect(resetOutcome("submitted")).toBe("unknown");
    expect(resetOutcome("requested")).toBe("unknown");
  });

  test("a thrown request is failed only when the server refused it with a 4xx", () => {
    expect(resetOutcomeOfError(403)).toBe("failed");
    expect(resetOutcomeOfError(409)).toBe("failed");
    expect(resetOutcomeOfError(500)).toBe("unknown");
    expect(resetOutcomeOfError(502)).toBe("unknown");
    expect(resetOutcomeOfError(null)).toBe("unknown");
  });
});
