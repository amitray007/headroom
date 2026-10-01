import { describe, expect, test } from "bun:test";

import {
  type ErrorCategory,
  attemptStates,
  errorCategories,
  errorCategoryClass,
  failureClassSchema,
  terminalAttemptStates,
} from "./enums.ts";

describe("enumerations", () => {
  test("every error category has a failure class", () => {
    for (const category of errorCategories) {
      expect(failureClassSchema.safeParse(errorCategoryClass[category]).success).toBe(true);
    }
  });

  test("only authentication and identity failures are definitive", () => {
    const definitive = errorCategories.filter((c) => errorCategoryClass[c] === "definitive");
    const expected: readonly ErrorCategory[] = [
      "approval_denied",
      "approval_expired",
      "authentication_required",
      "identity_mismatch",
    ];
    expect(definitive.toSorted()).toEqual(expected.toSorted());
  });

  test("terminal attempt states are a subset of attempt states", () => {
    for (const state of terminalAttemptStates) {
      expect(attemptStates).toContain(state);
    }
    expect(terminalAttemptStates).not.toContain("validating");
  });
});
