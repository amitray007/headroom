import { expect, test } from "bun:test";

import { parseSums, renderFormula } from "./render-formula.ts";

const digest = (n: number): string => n.toString(16).repeat(64).slice(0, 64);
const sums = [
  `${digest(1)}  headroom-darwin-arm64.tar.gz`,
  `${digest(2)}  headroom-darwin-x64.tar.gz`,
  `${digest(3)}  headroom-linux-arm64.tar.gz`,
  `${digest(4)}  headroom-linux-x64.tar.gz`,
  "",
].join("\n");

test("parseSums maps file names to digests", () => {
  const parsed = parseSums(`${sums}${digest(5)} *binary-mode.tar.gz\nnot a line\n`);
  expect(parsed.get("headroom-linux-x64.tar.gz")).toBe(digest(4));
  expect(parsed.get("binary-mode.tar.gz")).toBe(digest(5));
  expect(parsed.size).toBe(5);
});

test("the formula carries the version, each platform URL and digest", () => {
  const formula = renderFormula("1.2.3", sums);
  expect(formula).toContain("class Headroom < Formula");
  expect(formula).toContain('version "1.2.3"');
  expect(formula).toContain('license "MIT"');
  expect(formula).toContain(
    `url "https://github.com/amitray007/headroom/releases/download/v1.2.3/headroom-darwin-arm64.tar.gz"\n      sha256 "${digest(1)}"`,
  );
  expect(formula).toContain(`headroom-linux-x64.tar.gz"\n      sha256 "${digest(4)}"`);
  expect(formula).toContain('run [opt_bin/"headroom", "start"]');
  expect(formula).toContain("brew services start headroom");
  expect(formula).toContain('shell_output("#{bin}/headroom --version")');
});

test("a missing platform or a bad version is an error", () => {
  expect(() => renderFormula("1.2.3", sums.split("\n").slice(0, 3).join("\n"))).toThrow(
    "headroom-linux-x64.tar.gz",
  );
  expect(() => renderFormula("v1.2.3", sums)).toThrow("not a version");
});
