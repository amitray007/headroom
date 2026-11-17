import { expect, test } from "bun:test";

import { formatCode, normalizeCode, PairingService } from "./pairing.ts";

/** A seeded source, so every run draws the same codes and device codes. */
function counting(): (size: number) => Uint8Array {
  let state = 12345;
  return (size) =>
    Uint8Array.from({ length: size }, () => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return (state >>> 16) & 255;
    });
}

function clock(start = 1_000_000) {
  let at = start;
  return { now: () => new Date(at), advance: (ms: number) => void (at += ms) };
}

test("codes read as XXX-XXX and match with or without the dash, in any case", () => {
  const time = clock();
  const pairings = new PairingService(time.now, counting());
  const started = pairings.start("Studio Mac", "a");
  if (!started.ok) throw new Error("expected a pairing");
  expect(started.code).toMatch(
    /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/,
  );
  expect(normalizeCode(started.code.toLowerCase())).toBe(started.code.replace("-", ""));
  expect(formatCode("K7PQX4")).toBe("K7P-QX4");
  expect(normalizeCode("K7P-QX0")).toBeNull();
  expect(pairings.find(started.code.replace("-", "").toLowerCase())?.name).toBe("Studio Mac");
  expect(started.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("live pairings never share a code", () => {
  // A source that repeats itself once forces a second draw.
  const calls: number[][] = [
    [1, 2, 3, 4, 5, 6],
    [9, 9, 9],
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
  ];
  const random = (size: number): Uint8Array => {
    const next = calls.shift() ?? [0];
    return Uint8Array.from({ length: size }, (_, i) => next[i % next.length] ?? 0);
  };
  const pairings = new PairingService(clock().now, random);
  const first = pairings.start("A", "a");
  const second = pairings.start("B", "b");
  if (!first.ok || !second.ok) throw new Error("expected pairings");
  expect(second.code).not.toBe(first.code);
});

test("a poll sees pending, then the approval once, then nothing", () => {
  const pairings = new PairingService(clock().now, counting());
  const started = pairings.start("Studio Mac", "a");
  if (!started.ok) throw new Error("expected a pairing");
  expect(pairings.poll(started.deviceCode)).toEqual({ status: "pending" });
  expect(pairings.approve(started.code, "owner-1")).toBe("decided");
  expect(pairings.approve(started.code, "owner-1")).toBe("not_pending");
  expect(pairings.deny(started.code)).toBe("not_pending");
  expect(pairings.poll(started.deviceCode)).toEqual({
    status: "approved",
    name: "Studio Mac",
    userId: "owner-1",
  });
  expect(pairings.poll(started.deviceCode)).toEqual({ status: "unknown" });
  expect(pairings.find(started.code)?.status).toBe("approved");
});

test("a denial is reported once", () => {
  const pairings = new PairingService(clock().now, counting());
  const started = pairings.start("Studio Mac", "a");
  if (!started.ok) throw new Error("expected a pairing");
  expect(pairings.deny(started.code)).toBe("decided");
  expect(pairings.find(started.code)?.status).toBe("denied");
  expect(pairings.poll(started.deviceCode)).toEqual({ status: "denied" });
  expect(pairings.poll(started.deviceCode)).toEqual({ status: "unknown" });
});

test("a pairing expires after ten minutes, is reported once, and cannot be decided", () => {
  const time = clock();
  const pairings = new PairingService(time.now, counting());
  const started = pairings.start("Studio Mac", "a");
  if (!started.ok) throw new Error("expected a pairing");
  time.advance(599_000);
  expect(pairings.find(started.code)?.status).toBe("pending");
  time.advance(1_000);
  expect(pairings.find(started.code)).toBeNull();
  expect(pairings.approve(started.code, "owner-1")).toBe("unknown");
  expect(pairings.poll(started.deviceCode)).toEqual({ status: "expired" });
  expect(pairings.poll(started.deviceCode)).toEqual({ status: "unknown" });
});

test("an address may start ten pairings in ten minutes", () => {
  const time = clock();
  const pairings = new PairingService(time.now, counting());
  for (let i = 0; i < 10; i++) expect(pairings.start("Mac", "a").ok).toBe(true);
  const refused = pairings.start("Mac", "a");
  expect(refused).toEqual({ ok: false, retryAfterSeconds: 600 });
  expect(pairings.start("Mac", "b").ok).toBe(true);
  time.advance(601_000);
  expect(pairings.start("Mac", "a").ok).toBe(true);
});

test("at most one hundred pairings are live; expired ones are swept first", () => {
  const time = clock();
  const pairings = new PairingService(time.now, counting());
  for (let i = 0; i < 100; i++) expect(pairings.start("Mac", `client-${i}`).ok).toBe(true);
  const refused = pairings.start("Mac", "late");
  expect(refused.ok).toBe(false);
  time.advance(600_000);
  expect(pairings.start("Mac", "late").ok).toBe(true);
});
