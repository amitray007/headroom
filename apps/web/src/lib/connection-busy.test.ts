import { describe, expect, test } from "bun:test";

import { ApiError } from "../api.ts";
import { connectionBusyMessage, isConnectionBusy } from "./connection-busy.ts";

describe("isConnectionBusy", () => {
  test("is true only for the 409 connection_busy answer", () => {
    expect(isConnectionBusy(new ApiError(409, "Request failed (409)", "connection_busy"))).toBe(
      true,
    );
    expect(isConnectionBusy(new ApiError(409, "Request failed (409)", "demo_mode"))).toBe(false);
    expect(isConnectionBusy(new ApiError(500, "Request failed (500)", "connection_busy"))).toBe(
      false,
    );
    expect(isConnectionBusy(new ApiError(409, "Request failed (409)"))).toBe(false);
    expect(isConnectionBusy(new Error("connection_busy"))).toBe(false);
  });
  test("the message tells the owner what to do", () => {
    expect(connectionBusyMessage).toBe(
      "A refresh is running for this account. Try again in a moment.",
    );
  });
});
