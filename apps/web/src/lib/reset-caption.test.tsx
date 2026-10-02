import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";

import { ResetCaption, resetVerb } from "./reset-caption.tsx";

const soon = Date.now() + 3 * 86_400_000 + 3_600_000;

describe("ResetCaption", () => {
  test("a rolling window resets, a cycle ends", () => {
    expect(renderToString(<ResetCaption resetWords="resets" resetsAt={soon} />)).toContain(
      "Resets in ",
    );
    expect(renderToString(<ResetCaption resetWords="cycle_end" resetsAt={soon} />)).toContain(
      "Cycle ends in ",
    );
  });
  test("a pool that follows the cycle shows no time", () => {
    expect(renderToString(<ResetCaption resetWords="with_cycle" resetsAt={null} />)).toBe(
      "Resets with the cycle",
    );
    expect(renderToString(<ResetCaption resetWords="with_cycle" resetsAt={soon} />)).toBe(
      "Resets with the cycle",
    );
  });
  test("a session that has not started, and a missing time", () => {
    expect(renderToString(<ResetCaption resetWords="not_started" resetsAt={null} />)).toBe(
      "Not Started",
    );
    expect(renderToString(<ResetCaption resetWords="resets" resetsAt={null} />)).toBe(
      "No reset time",
    );
  });
  test("verb", () => {
    expect(resetVerb("resets")).toBe("Resets");
    expect(resetVerb("with_cycle")).toBe("Cycle ends");
  });
});
