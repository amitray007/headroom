import { describe, expect, test } from "bun:test";

import { scorePassword } from "./password-score.ts";

const rule = (password: string, id: string): boolean | undefined =>
  scorePassword(password, 12).rules.find((entry) => entry.id === id)?.met;

describe("scorePassword", () => {
  test("nothing typed has no level", () => {
    expect(scorePassword("", 12)).toMatchObject({ level: 0, label: "" });
  });

  test("below the server minimum is Too Short, however varied", () => {
    expect(scorePassword("aB3$xY9!", 12)).toMatchObject({ level: 1, label: "Too Short" });
  });

  test("counts the length rule and the characters still missing", () => {
    const length = scorePassword("abcdefg", 12).rules[0];
    expect(length).toMatchObject({ met: false, remaining: 5 });
    expect(scorePassword("a".repeat(12), 12).rules[0]).toMatchObject({ met: true, remaining: 0 });
  });

  test("counts code points, not UTF-16 units", () => {
    expect(scorePassword("😀".repeat(6), 12).rules[0]?.met).toBe(false);
    expect(scorePassword("😀".repeat(12), 12).rules[0]?.met).toBe(true);
  });

  test("long but repeated or sequential passwords stay Weak", () => {
    expect(scorePassword("aaaaaaaaaaaaaaaa", 12).label).toBe("Weak");
    expect(scorePassword("123456789012", 12).label).toBe("Weak");
    expect(rule("aaaaaaaaaaaaaaaa", "varied")).toBe(false);
  });

  test("a common word caps the level at Weak", () => {
    expect(scorePassword("MyPassword-Is-Long-9", 12)).toMatchObject({ level: 1, label: "Weak" });
    expect(rule("MyPassword-Is-Long-9", "plain")).toBe(false);
  });

  test("levels rise with length and character variety", () => {
    expect(scorePassword("tqzmxvbwpjdh", 12).label).toBe("Fair");
    expect(scorePassword("tqzmxvbwpjdhnfrk", 12).label).toBe("Good");
    expect(scorePassword("tqzmxvbwpjdhnfrkcgls", 12).label).toBe("Strong");
    expect(scorePassword("tR9#vK2$mQ7!", 12).label).toBe("Good");
    expect(scorePassword("tR9#vK2$mQ7!zL4&", 12).label).toBe("Strong");
  });

  test("a passphrase of unrelated words is Strong", () => {
    expect(scorePassword("lantern otter quarry violet", 12)).toMatchObject({
      level: 4,
      label: "Strong",
    });
  });

  test("honours a different server minimum", () => {
    expect(scorePassword("tqzmxvbwpjdh", 16).label).toBe("Too Short");
  });
});
