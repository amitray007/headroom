import { describe, expect, test } from "bun:test";

import { connection, percent } from "../../lib/test-fixtures.ts";
import { laneOf } from "./lanes.ts";
import { laneTips, tipLabel, usedText, windowTip, type TipContext } from "./tips.ts";

const hour = 3_600_000;
const now = new Date(2025, 9, 3, 11, 0).getTime();
const context: TipContext = { now, clock: "24h", view: "used", low: 30 };

const account = connection("claude", {
  name: "Work",
  metrics: [
    percent("seven_day", 91, { resetsAt: new Date(2025, 9, 5, 19, 0).getTime() }),
    percent("five_hour", 20, { scope: "window:18000s", resetsAt: now + hour }),
  ],
});

describe("popover wording", () => {
  const lane = laneOf(account, "weekly", now);
  if (lane === null) throw new Error("expected a weekly lane");
  test("the current window says when it resets, in our wording", () => {
    const tip = windowTip(lane, "cur", context);
    expect(tip.title).toBe("Claude · Work · Weekly");
    expect(tip.when).toBe("Resets in 2 days 8 h · Sun, Oct 5 · 19:00");
    expect(tip.lines[0]).toEqual({ text: "91% Used · Weekly", tone: "bad" });
    expect(tip.lines.map((line) => line.text)).toContain("Opened Sun, Sep 28 · 19:00");
  });
  test("Left flips the figure", () => {
    expect(usedText(91, { ...context, view: "left" })).toBe("9% Left");
    expect(usedText(null, context)).toBe("Not reported");
  });
  test("the earlier window says it is worked out from the length", () => {
    const tip = windowTip(lane, "prev", context);
    expect(tip.when).toBe("Earlier window · ended Sun, Sep 28 · 19:00");
    expect(tip.lines.map((line) => line.text)).toContain("Worked out from the window length");
  });
  test("the next window opens when this one resets", () => {
    const tip = windowTip(lane, "next", context);
    expect(tip.when).toBe("Next window · opens Sun, Oct 5 · 19:00");
    expect(tip.lines[0]?.text).toBe("Resets Sun, Oct 12 · 19:00");
  });
  test("a session's next window starts on next use", () => {
    const session = laneOf(account, "session", now);
    if (session === null) throw new Error("expected a session lane");
    expect(windowTip(session, "next", context).when).toBe("Next window · starts on next use");
  });
  test("every bar of a current lane has a popover, and a label is one sentence", () => {
    const tips = laneTips([lane], context);
    expect([...tips.keys()]).toEqual([`${lane.id}:prev`, `${lane.id}:cur`, `${lane.id}:next`]);
    expect(tipLabel(windowTip(lane, "cur", context))).toContain("Resets in 2 days 8 h");
  });
});
