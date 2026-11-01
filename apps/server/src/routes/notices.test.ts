import { describe, expect, test } from "bun:test";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

async function harness() {
  const ctx = testContext();
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const put = (body: unknown, headers: Record<string, string> = { cookie }) =>
    app.request(url(ctx, "/api/notices/read"), {
      ...jsonPost(ctx, body, headers),
      method: "PUT",
    });
  const get = (headers: Record<string, string> = { cookie }) =>
    app.request(url(ctx, "/api/notices/read"), { headers });
  return { ctx, app, cookie, put, get };
}

describe("notice read routes", () => {
  test("a session reads the set, marks ids read in one call and unread again", async () => {
    const h = await harness();
    expect(await (await h.get()).json()).toEqual({ ids: [] });
    const marked = await h.put({ ids: ["b", "a", "a"], read: true });
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ ids: ["a", "b"] });
    expect(await (await h.get()).json()).toEqual({ ids: ["a", "b"] });
    const unread = await h.put({ ids: ["a", "never-read"], read: false });
    expect(await unread.json()).toEqual({ ids: ["b"] });
  });

  test("needs a session and a valid body", async () => {
    const h = await harness();
    expect((await h.get({})).status).toBe(401);
    expect((await h.put({ ids: ["a"], read: true }, {})).status).toBe(401);
    for (const body of [null, {}, { ids: ["a"] }, { ids: [1], read: true }, { ids: [], read: 1 }]) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps the failures readable
      const response = await h.put(body);
      expect(response.status).toBe(400);
      // eslint-disable-next-line no-await-in-loop -- see above
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
    expect(h.ctx.noticeReads.list()).toEqual([]);
  });
});
