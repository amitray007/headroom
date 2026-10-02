import { describe, expect, test } from "bun:test";

import {
  checkWebhookUrl,
  hostOf,
  insecureWarning,
  isBotToken,
  isChatId,
  isLocalHost,
  urlCredentialsProblem,
  urlProblem,
} from "./validate.ts";

describe("isBotToken", () => {
  test("accepts the BotFather shape", () => {
    expect(isBotToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(true);
    expect(isBotToken("  123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw ")).toBe(true);
  });
  test("rejects other text", () => {
    expect(isBotToken("")).toBe(false);
    expect(isBotToken("123:short")).toBe(false);
    expect(isBotToken("not a token")).toBe(false);
    expect(isBotToken("abcdef:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(false);
  });
});

describe("isChatId", () => {
  test("accepts numbers and @names", () => {
    for (const id of ["123456789", "-1001234567890", "@headroom_chat"]) {
      expect(isChatId(id)).toBe(true);
    }
  });
  test("rejects the rest", () => {
    for (const id of ["", "abc", "@abc", "12 34", "@has space", "1".repeat(21)]) {
      expect(isChatId(id)).toBe(false);
    }
  });
});

describe("isLocalHost", () => {
  test("knows private and local hosts", () => {
    for (const host of [
      "localhost",
      "box.local",
      "mac.tail1234.ts.net",
      "10.1.2.3",
      "127.0.0.1",
      "172.16.0.1",
      "172.31.255.1",
      "192.168.1.20",
      "[::1]",
    ]) {
      expect(isLocalHost(host)).toBe(true);
    }
  });
  test("treats public hosts as not local", () => {
    for (const host of ["example.com", "172.32.0.1", "172.15.0.1", "8.8.8.8", "192.169.0.1"]) {
      expect(isLocalHost(host)).toBe(false);
    }
  });
});

describe("checkWebhookUrl", () => {
  test("accepts https with no warning", () => {
    expect(checkWebhookUrl("https://example.com/headroom")).toEqual({ ok: true, warning: null });
  });
  test("warns on http to a public host only", () => {
    expect(checkWebhookUrl("http://example.com/x")).toEqual({ ok: true, warning: insecureWarning });
    expect(checkWebhookUrl("http://192.168.1.5:8080/x")).toEqual({ ok: true, warning: null });
    expect(checkWebhookUrl("http://localhost:3000")).toEqual({ ok: true, warning: null });
  });
  test("rejects what is not a full URL", () => {
    for (const text of ["", "example.com", "ftp://example.com", "https://"]) {
      expect(checkWebhookUrl(text)).toEqual({ ok: false, problem: urlProblem });
    }
  });
  test("rejects a user name and password", () => {
    expect(checkWebhookUrl("https://user:pass@example.com")).toEqual({
      ok: false,
      problem: urlCredentialsProblem,
    });
  });
  test("rejects a URL over 2048 characters", () => {
    expect(checkWebhookUrl(`https://example.com/${"a".repeat(2048)}`)).toEqual({
      ok: false,
      problem: urlProblem,
    });
  });
});

describe("hostOf", () => {
  test("gives the host, or the text when it is not a URL", () => {
    expect(hostOf(" https://example.com:8080/x ")).toBe("example.com:8080");
    expect(hostOf("nope")).toBe("nope");
  });
});
