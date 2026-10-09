import { describe, expect, test } from "bun:test";

import {
  acceptsLabel,
  clockLeft,
  defaultMethod,
  isTerminal,
  isUsable,
  pasteInputKind,
  shouldPoll,
  stoppedReason,
  unavailableNote,
} from "./steps.ts";
import type { Attempt } from "../api.ts";

function attempt(state: Attempt["state"], pollAfterMs = 0): Attempt {
  return {
    id: "a1",
    provider: "claude",
    method: "device_code",
    state,
    nextStep: null,
    error: null,
    connectionId: null,
    expiresAt: 1,
    pollAfterMs,
  };
}

describe("attempt states", () => {
  test("terminal states end the attempt", () => {
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("awaiting_user")).toBe(false);
  });
  test("poll while the owner has nothing to type", () => {
    expect(shouldPoll(attempt("awaiting_user"))).toBe(true);
    expect(shouldPoll(attempt("validating"))).toBe(true);
    expect(shouldPoll(attempt("awaiting_input"))).toBe(false);
  });
  test("the server can ask for polling in an input state", () => {
    expect(shouldPoll(attempt("awaiting_input", 2000))).toBe(true);
  });
  test("never poll after a terminal state", () => {
    expect(shouldPoll(attempt("succeeded", 2000))).toBe(false);
    expect(shouldPoll(attempt("expired"))).toBe(false);
  });
});

describe("pasteInputKind", () => {
  test("decides by shape when both are accepted", () => {
    expect(pasteInputKind("url_or_code", "https://example.com/cb?code=x")).toBe("redirect");
    expect(pasteInputKind("url_or_code", "ABCD-1234")).toBe("code");
    expect(pasteInputKind("url", "x")).toBe("redirect");
    expect(pasteInputKind("code", "https://example.com")).toBe("code");
  });
});

describe("acceptsLabel", () => {
  test("names what to paste", () => {
    expect(acceptsLabel("url")).toBe("Address You Landed On");
    expect(acceptsLabel("code")).toBe("Code Shown");
    expect(acceptsLabel("url_or_code")).toBe("Address or Code");
  });
});

describe("defaultMethod", () => {
  test("skips file import when another method exists", () => {
    expect(defaultMethod(["import", "device_code"])).toBe("device_code");
    expect(defaultMethod(["import"])).toBe("import");
    expect(defaultMethod([])).toBeNull();
  });
});

describe("method availability", () => {
  const missing = {
    method: "cli_login",
    available: false,
    reason: "cli_not_installed",
    cli: "codex",
  } as const;

  test("falls through to import when the CLI method is unavailable", () => {
    expect(defaultMethod(["cli_login", "import"], [missing])).toBe("import");
    expect(defaultMethod(["cli_login", "import"], [])).toBe("cli_login");
  });

  test("returns null when nothing can start", () => {
    expect(defaultMethod(["cli_login"], [missing])).toBeNull();
  });

  test("a method the server did not list is usable", () => {
    expect(isUsable("import", [missing])).toBe(true);
    expect(isUsable("cli_login", [missing])).toBe(false);
  });

  test("the note says what to install and what to use instead", () => {
    expect(unavailableNote("Codex", missing, ["import"])).toBe(
      "Needs the Codex CLI on the server. Install it, or use Import.",
    );
    expect(unavailableNote("Codex", missing, [])).toBe(
      "Needs the Codex CLI on the server. Install it, then try again.",
    );
  });
});

describe("clockLeft", () => {
  test("shows minutes and padded seconds", () => {
    expect(clockLeft(1_000_000 + 582_000, 1_000_000)).toBe("9:42");
    expect(clockLeft(1_000_000 + 60_000, 1_000_000)).toBe("1:00");
  });
  test("rounds partial seconds up and stops at zero", () => {
    expect(clockLeft(1_000_500, 1_000_000)).toBe("0:01");
    expect(clockLeft(1_000_000, 2_000_000)).toBe("0:00");
  });
});

describe("stoppedReason", () => {
  test("expired and cancelled have their own words", () => {
    expect(stoppedReason({ state: "expired", error: null })).toBe(
      "The approval expired. Nothing was saved.",
    );
    expect(stoppedReason({ state: "cancelled", error: null })).toBe(
      "The sign-in was cancelled. Nothing was saved.",
    );
  });
  test("a failure maps its category to plain words", () => {
    expect(stoppedReason({ state: "failed", error: "rate_limited: HTTP 429 secret" })).toBe(
      "The provider asked to slow down. Nothing was saved. Try again in a minute.",
    );
  });
  test("an unknown category falls back and never leaks the raw text", () => {
    const text = stoppedReason({ state: "failed", error: "weird_thing: token abc" });
    expect(text).toBe(
      "The provider rejected the sign-in. Nothing was saved. Check the account and try again.",
    );
    expect(text).not.toContain("abc");
  });
});
