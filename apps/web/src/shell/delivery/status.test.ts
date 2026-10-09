import { describe, expect, test } from "bun:test";

import { ApiError, demoRefusal } from "../../api.ts";

import {
  chatTypeWord,
  failureText,
  botCheckProblem,
  changeProblem,
  codeOf,
  botNameOf,
  destinationName,
  destinationState,
  rotationProblem,
  saveProblem,
  statusLine,
  testProblem,
} from "./status.ts";

const now = 1_000_000_000_000;
const minute = 60_000;

describe("failureText", () => {
  test("differs by channel where the cause differs", () => {
    expect(failureText("telegram", "unauthorized")).toBe("Telegram did not accept the bot token.");
    expect(failureText("webhook", "unauthorized")).toBe(
      "Your receiver refused it. Check that it uses this secret.",
    );
    expect(failureText("webhook", "not_found")).toBe("Nothing answered at this path.");
    expect(failureText("webhook", "rejected")).toBe("Your receiver rejected the request.");
    expect(failureText("webhook", "server_error")).toBe("Your receiver had an error.");
    expect(failureText("webhook", "timeout")).toBe("Headroom could not reach this URL.");
  });
  test("is shared where the cause is the same", () => {
    expect(failureText("telegram", "rate_limited")).toBe(failureText("webhook", "rate_limited"));
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
    expect(line.text).toBe("Last failed 5 min ago. Headroom could not reach this URL.");
    expect(line.tone).toBe("bad");
  });
});

test("chat type words", () => {
  expect(chatTypeWord("private")).toBe("Private");
  expect(chatTypeWord("supergroup")).toBe("Group");
  expect(chatTypeWord("channel")).toBe("Channel");
  expect(chatTypeWord("other")).toBe("Chat");
});

test("destination state", () => {
  expect(destinationState(null)).toEqual({ mark: "none", label: "Not Set Up" });
  expect(destinationState({ enabled: false, lastDelivery: null }).mark).toBe("off");
  expect(destinationState({ enabled: true, lastDelivery: null })).toEqual({
    mark: "on",
    label: "Set Up",
  });
  const sent = { status: "delivered", at: now - 2 * minute, failure: null } as const;
  expect(destinationState({ enabled: true, lastDelivery: sent }).mark).toBe("on");
  const failed = { status: "failed", at: now - minute, failure: "timeout" } as const;
  expect(destinationState({ enabled: true, lastDelivery: failed }).mark).toBe("failing");
  const retrying = { status: "retrying", at: now - minute, failure: "network" } as const;
  expect(destinationState({ enabled: true, lastDelivery: retrying }).mark).toBe("failing");
});

test("names", () => {
  expect(destinationName("telegram")).toBe("Telegram");
  expect(botNameOf("@family_bot \u00b7 Family")).toBe("@family_bot");
  expect(botNameOf("@family_bot")).toBe("@family_bot");
});

test("bot check problem", () => {
  expect(botCheckProblem("telegram_token_rejected")).toBe(
    "Telegram did not accept this token. Copy it again from BotFather.",
  );
  expect(botCheckProblem("timeout")).toBe("Headroom could not reach Telegram. Try again.");
  expect(botCheckProblem(null)).toBe("Headroom could not reach Telegram. Try again.");
});

test("test problem", () => {
  expect(testProblem("webhook", "not_found")).toBe("Nothing answered at this path.");
  expect(testProblem("webhook", "nonsense")).toBe("Headroom could not send it.");
  expect(testProblem("telegram", null)).toBe("Headroom could not send it.");
});

describe("a demo refusal", () => {
  test("reads the same on every delivery surface", () => {
    expect(botCheckProblem("demo_mode")).toBe(demoRefusal);
    expect(testProblem("webhook", "demo_mode")).toBe(demoRefusal);
    expect(testProblem("telegram", "demo_mode")).toBe(demoRefusal);
    expect(saveProblem("demo_mode")).toBe(demoRefusal);
    expect(changeProblem("demo_mode")).toBe(demoRefusal);
    expect(rotationProblem("demo_mode")).toBe(demoRefusal);
  });
  test("leaves the other failures as they were", () => {
    expect(saveProblem(null)).toBe(
      "Headroom could not save this. Check the details and try again.",
    );
    expect(changeProblem("x")).toBe("Headroom could not save that change. Try again.");
    expect(rotationProblem(null)).toBe("Headroom could not make a new secret. Try again.");
  });
  test("reaches the mapping as the error word of an ApiError", () => {
    expect(codeOf(new ApiError(409, "Request failed (409)", "demo_mode"))).toBe("demo_mode");
    expect(codeOf(new Error("x"))).toBeNull();
    expect(botCheckProblem(codeOf(new ApiError(409, "m", "demo_mode")))).toBe(demoRefusal);
  });
});
