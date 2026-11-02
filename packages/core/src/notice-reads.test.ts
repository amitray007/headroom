import { describe, expect, test } from "bun:test";

import { openDatabase } from "./db/index.ts";
import { NoticeReadStore, noticeReadRetentionMs } from "./notice-reads.ts";

function store() {
  let now = Date.UTC(2026, 10, 1);
  const { db } = openDatabase({ path: ":memory:" });
  return {
    store: new NoticeReadStore(db, () => new Date(now)),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("NoticeReadStore", () => {
  test("starts empty and keeps a sorted set without duplicates", () => {
    const { store: s } = store();
    expect(s.list()).toEqual([]);
    expect(s.mark(["b", "a", "b"], true)).toEqual(["a", "b"]);
    expect(s.mark(["a"], true)).toEqual(["a", "b"]);
  });

  test("marks ids unread and ignores ids that were never read", () => {
    const { store: s } = store();
    s.mark(["a", "b", "c"], true);
    expect(s.mark(["b", "zzz"], false)).toEqual(["a", "c"]);
    expect(s.mark([], true)).toEqual(["a", "c"]);
  });

  test("a write drops marks read more than 90 days ago, and only on a write", () => {
    const { store: s, advance } = store();
    s.mark(["old"], true);
    advance(noticeReadRetentionMs - 1);
    s.mark(["fresh"], true);
    expect(s.list()).toEqual(["fresh", "old"]);
    advance(2);
    expect(s.list()).toEqual(["fresh", "old"]);
    expect(s.mark([], true)).toEqual(["fresh"]);
  });

  test("reading an id again does not extend its retention", () => {
    const { store: s, advance } = store();
    s.mark(["a"], true);
    advance(noticeReadRetentionMs - 1000);
    s.mark(["a"], true);
    advance(2000);
    expect(s.mark([], true)).toEqual([]);
  });
});
