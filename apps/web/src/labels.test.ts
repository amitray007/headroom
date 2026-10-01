import { describe, expect, test } from "bun:test";

import {
  attemptStateLabel,
  connectionStateLabel,
  isTerminal,
  pasteInputKind,
  shouldPoll,
  stepForm,
} from "./labels.ts";

describe("state labels", () => {
  test("label every state", () => {
    expect(connectionStateLabel("reconnect_required")).toBe("Reconnect required");
    expect(attemptStateLabel("awaiting_user")).toBe("Waiting for you");
  });
  test("terminal and polling states", () => {
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("awaiting_user")).toBe(false);
    expect(shouldPoll("awaiting_user")).toBe(true);
    expect(shouldPoll("awaiting_input")).toBe(false);
    expect(shouldPoll("succeeded")).toBe(false);
  });
});

describe("stepForm", () => {
  test("link-only steps have no form", () => {
    expect(stepForm({ kind: "open_url", url: "https://example.com", expiresAt: 1 })).toBe("none");
    expect(
      stepForm({
        kind: "device_code",
        verificationUrl: "https://example.com",
        userCode: "ABCD",
        expiresAt: 1,
      }),
    ).toBe("none");
  });
  test("paste_redirect depends on what it accepts", () => {
    const step = { kind: "paste_redirect", url: "https://example.com", expiresAt: 1 } as const;
    expect(stepForm({ ...step, accepts: "code" })).toBe("code");
    expect(stepForm({ ...step, accepts: "url" })).toBe("redirect");
    expect(stepForm({ ...step, accepts: "url_or_code" })).toBe("redirect");
  });
  test("input steps map to their form", () => {
    expect(stepForm({ kind: "select_account", options: [{ id: "a", label: "A" }] })).toBe(
      "selection",
    );
    expect(stepForm({ kind: "paste_file", expectedFileName: "auth.json", hint: "" })).toBe("file");
  });
});

describe("pasteInputKind", () => {
  test("decides by shape when both are accepted", () => {
    expect(pasteInputKind("url_or_code", "https://example.com/cb?code=x")).toBe("redirect");
    expect(pasteInputKind("url_or_code", "ABCD-1234")).toBe("code");
    expect(pasteInputKind("url", "x")).toBe("redirect");
  });
});
