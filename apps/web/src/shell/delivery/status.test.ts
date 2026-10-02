import { describe, expect, test } from "bun:test";

import {
  chatTypeWord,
  failureText,
  isFullUrl,
  problemText,
  statusLine,
  testProblem,
} from "./status.ts";

const now = 1_000_000_000_000;
const minute = 60_000;

describe("failureText", () => {
  test("differs by channel where the cause differs", () => {
    expect(failureText("telegram", "unauthorized")).toBe("Telegram did not accept the bot token.");
    expect(failureText("webhook", "unauthorized")).toBe("The URL refused the request.");
    expect(failureText("webhook", "not_found")).toBe("The URL was not found.");
  });
  test("is shared otherwise", () => {
    expect(failureText("telegram", "timeout")).toBe(failureText("webhook", "timeout"));
  });
});

describe("statusLine", () => {
  test("nothing sent", () => {
    expect(statusLine({ type: "webhook", lastDelivery: null }, now).text).toBe("Nothing sent yet");
  });
  test("delivered", () => {
    const line = statusLine(
      {
        type: "webhook",
        lastDelivery: { status: "delivered", at: now - 3 * minute, failure: null },
      },
      now,
    );
    expect(line).toEqual({ text: "Last sent 3 min ago", tone: "good" });
  });
  test("retrying", () => {
    const line = statusLine(
      { type: "telegram", lastDelivery: { status: "retrying", at: now, failure: "rate_limited" } },
      now,
    );
    expect(line.text).toBe("Retrying. Too many messages. Headroom will try again.");
    expect(line.tone).toBe("warn");
  });
  test("failed", () => {
    const line = statusLine(
      {
        type: "webhook",
        lastDelivery: { status: "failed", at: now - 5 * minute, failure: "network" },
      },
      now,
    );
    expect(line.text).toBe("Last failed 5 min ago. Headroom could not reach it.");
    expect(line.tone).toBe("bad");
  });
});

test("chat type words", () => {
  expect(chatTypeWord("private")).toBe("Private");
  expect(chatTypeWord("supergroup")).toBe("Group");
  expect(chatTypeWord("channel")).toBe("Channel");
  expect(chatTypeWord("other")).toBe("Chat");
});

test("URL check", () => {
  expect(isFullUrl("https://example.com/headroom")).toBe(true);
  expect(isFullUrl(" http://localhost:3000 ")).toBe(true);
  expect(isFullUrl("example.com")).toBe(false);
  expect(isFullUrl("https://")).toBe(false);
});

test("problem text", () => {
  expect(problemText("telegram_token_rejected", "x")).toBe("Telegram did not accept this token.");
  expect(problemText("invalid_body", "fallback")).toBe("fallback");
  expect(problemText(null, "fallback")).toBe("fallback");
});

test("test problem", () => {
  expect(testProblem("webhook", "not_found")).toBe("The URL was not found.");
  expect(testProblem("webhook", "nonsense")).toBe("Headroom could not send it.");
  expect(testProblem("telegram", null)).toBe("Headroom could not send it.");
});
