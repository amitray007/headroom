import { expect, test } from "bun:test";

import { ReleaseNotice } from "./release-notice.ts";

const day = 86_400_000;

function setup(responses: (() => Response)[]) {
  let now = 1_700_000_000_000;
  let calls = 0;
  const notice = new ReleaseNotice({
    version: "0.2.0",
    now: () => new Date(now),
    fetch: () => {
      calls += 1;
      const next = responses.shift();
      return next ? Promise.resolve(next()) : Promise.reject(new Error("offline"));
    },
  });
  return { notice, calls: () => calls, advance: (ms: number) => (now += ms) };
}

const release = (tag: string) => () => Response.json({ tag_name: tag });

test("offers a newer release with its notes page", async () => {
  const h = setup([release("v0.3.0")]);
  expect(await h.notice.view()).toEqual({
    version: "0.2.0",
    update: {
      version: "0.3.0",
      notesUrl: "https://github.com/amitray007/headroom/releases/tag/v0.3.0",
    },
  });
});

test("offers nothing when the running version is current", async () => {
  const h = setup([release("v0.2.0")]);
  expect((await h.notice.view()).update).toBeNull();
});

test("asks GitHub at most once a day and keeps the last answer on failure", async () => {
  const h = setup([release("v0.3.0")]);
  await h.notice.view();
  await h.notice.view();
  expect(h.calls()).toBe(1);
  h.advance(day);
  expect((await h.notice.view()).update?.version).toBe("0.3.0");
  expect(h.calls()).toBe(2);
});
