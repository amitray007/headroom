// Timeline-only data: every quota window as a span (opened to resets), derived from data.js.
// data.js gives "resets in N minutes"; a window opened one window length before that.
import { accounts, now, at } from "./data.js";

const MIN = 60_000;
export const H = 60 * MIN;
export const D = 24 * H;
export { accounts, now };

/** Window kinds the switch can draw. Lengths are the provider's window sizes. */
export const KINDS = {
  weekly: { label: "Weekly", len: 7 * D },
  "5h": { label: "5-Hour", len: 5 * H },
  cycle: { label: "Cycle", len: 30 * D },
};

export const kindOf = (meter) =>
  meter.window === "5 hours"
    ? "5h"
    : meter.words || /monthly|billing/i.test(meter.window)
      ? "cycle"
      : "weekly";

/** Short limit name for a chip: "Session", "Weekly", "Fable", "Auto Pool". */
export const limitName = (m) =>
  m.label === "Weekly" && m.window !== "all models" && m.window !== "7 days" ? m.window : m.label;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
export const wd = (ms) => WD[new Date(ms).getDay()];
export const hhmm = (ms) => `${p2(new Date(ms).getHours())}:${p2(new Date(ms).getMinutes())}`;
export const shortDay = (ms) => `${MO[new Date(ms).getMonth()]} ${new Date(ms).getDate()}`;
/** "Mon, Oct 5 · 19:00" */
export const when = (ms) => `${wd(ms)}, ${shortDay(ms)} · ${hhmm(ms)}`;
export const startOfDay = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Lanes for one window kind: accounts that have at least one limit of that kind. */
export function lanesFor(kind) {
  const len = KINDS[kind].len;
  const out = [];
  for (const account of accounts) {
    const meters = account.meters.filter((m) => kindOf(m) === kind);
    if (meters.length === 0) continue;
    const started = meters.filter((m) => m.resets !== null);
    const notStarted = started.length === 0;
    const end = notStarted ? now + len : at(started[0].resets);
    const start = notStarted ? now : end - len;
    const known = meters.filter((m) => m.used !== null);
    out.push({
      account,
      kind,
      meters,
      notStarted,
      used: known.length ? Math.max(...known.map((m) => m.used)) : null,
      start,
      end,
      len,
      prev: notStarted ? null : { start: start - len, end: start },
      next: notStarted ? null : { start: end, end: end + len },
      banks: (account.banked?.expiries ?? []).map((m, i) => ({
        t: at(m),
        i,
        label: account.banked.label,
        count: account.banked.count,
      })),
    });
  }
  return out;
}
