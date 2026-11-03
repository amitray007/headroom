import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { fixtureDirectories, macFixture } from "./mac-fixtures.ts";

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

// Demo Mode decodes the app's bundled copy, so a stale copy fails only in the running app.
test("the app's Demo Mode feed matches the generated fixture", async () => {
  for (const directory of Object.values(fixtureDirectories)) {
    const committed = JSON.parse(
      await readFile(new URL(`${directory}demo.json`, import.meta.url), "utf8"),
    );
    expect(committed).toEqual(macFixture());
  }
});
