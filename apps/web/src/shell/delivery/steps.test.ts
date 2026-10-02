import { describe, expect, test } from "bun:test";

import { stepperAt } from "./steps.ts";

describe("stepperAt", () => {
  test("counts steps from 1", () => {
    expect(stepperAt("first", false)).toEqual({ step: 1, state: "current" });
    expect(stepperAt("second", false)).toEqual({ step: 2, state: "current" });
  });
  test("marks a failed test on its own step", () => {
    expect(stepperAt("test", true)).toEqual({ step: 3, state: "failed" });
  });
  test("reads the last step as done", () => {
    expect(stepperAt("done", false)).toEqual({ step: 4, state: "done" });
  });
});
