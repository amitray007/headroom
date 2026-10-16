/** One stored percent reading of a limit: when it was observed, percent used, and the reset time it reported. */
export interface PaceReading {
  readonly at: number;
  readonly used: number;
  readonly resetsAt: number | null;
}

const hour = 3_600_000;
/** The trail is one day because v1 covers weekly limits only (a seventh of the window). */
const trailMs = 24 * hour;
/** Reset times within this distance are one window; the provider reports them with jitter. */
const sameResetMs = 10 * 60_000;
/** A fall bigger than this is an early reset or a correction, not rounding noise. */
const dropPoints = 1;
const minReadings = 4;
/** The trail must include some idle hours, so a busy afternoon does not read as the pace of a day. */
const minSpanMs = 18 * hour;
/** Below this the gain is noise from rounding and reading jitter. */
const minGainPoints = 2;
/** The idle gate: usage must continue in the last 6 hours, or an old burst would project forever. */
const recentMs = 6 * hour;
const minRecentGainPoints = 1;

/**
 * The recent burn rate of one percent limit, from its stored readings, or null when it cannot be told.
 *
 * The newest reading anchors the trail and must carry a reset time in the future. The trail keeps the
 * last 24 hours of one period: it stops at a reading with no reset time or a different one, which drops
 * an earlier window and a reset time that still slides before first use (an unused Codex window moves
 * its reset time with every reading). It also starts at the last drop in used percent, which is an early
 * reset. Four readings spanning 18 hours, 2 points of gain and 1 point in the last 6 hours are the gates:
 * each one keeps a thin, idle or noisy trail from becoming a rate. Unknown is null, never zero.
 */
export function paceOf(
  readings: readonly PaceReading[],
): { ratePerHour: number; from: number; to: number } | null {
  const sorted = readings.toSorted((a, b) => a.at - b.at);
  const anchor = sorted.at(-1);
  if (anchor === undefined || anchor.resetsAt === null || anchor.resetsAt <= anchor.at) return null;
  const anchorReset = anchor.resetsAt;

  let trail = sorted.filter((r) => r.at >= anchor.at - trailMs);
  const lastForeign = trail.findLastIndex(
    (r) => r.resetsAt === null || Math.abs(r.resetsAt - anchorReset) > sameResetMs,
  );
  trail = trail.slice(lastForeign + 1);
  const lastDrop = trail.findLastIndex((r, i) => i > 0 && r.used < trail[i - 1]!.used - dropPoints);
  if (lastDrop > 0) trail = trail.slice(lastDrop);

  const first = trail[0];
  const last = trail.at(-1);
  if (first === undefined || last === undefined || trail.length < minReadings) return null;
  const span = last.at - first.at;
  if (span < minSpanMs) return null;
  const gain = last.used - first.used;
  if (gain < minGainPoints) return null;
  const earlier = trail.findLast((r) => r.at <= last.at - recentMs);
  if (earlier === undefined || last.used - earlier.used < minRecentGainPoints) return null;
  return { ratePerHour: gain / (span / hour), from: first.at, to: last.at };
}
