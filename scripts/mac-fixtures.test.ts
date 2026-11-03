import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { macFixture } from "./mac-fixtures.ts";

test("Mac fixtures come from deterministic Demo Mode data with synthetic account labels", async () => {
  const feed = macFixture();
  const committed = JSON.parse(
    await readFile(
      new URL(
        "../apps/macos/HeadroomKit/Tests/HeadroomKitTests/Fixtures/demo.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(committed).toEqual(feed);
  expect(feed.accounts.length).toBeGreaterThan(0);
  expect(feed.accounts.every((account) => /^Account \d+$/.test(account.name))).toBe(true);
  expect(feed.accounts.every((account) => account.identity?.endsWith("@example.invalid"))).toBe(
    true,
  );
  expect(
    feed.accounts.some((account) => account.limits.some((limit) => limit.percentLeft === null)),
  ).toBe(true);
});
