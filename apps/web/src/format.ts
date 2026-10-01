const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "x minutes ago" for a past epoch-ms time. */
export function formatAge(epochMs: number, now: number): string {
  const diff = now - epochMs;
  if (diff < minute) return "just now";
  if (diff < hour) return `${plural(Math.floor(diff / minute), "minute")} ago`;
  if (diff < day) return `${plural(Math.floor(diff / hour), "hour")} ago`;
  return `${plural(Math.floor(diff / day), "day")} ago`;
}

/** "m:ss" left until a deadline, or "expired". */
export function formatTimeLeft(expiresAt: number, now: number): string {
  const seconds = Math.ceil((expiresAt - now) / 1000);
  if (seconds <= 0) return "expired";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Epoch ms as local date-time; null or undefined as a dash. */
export function formatDateTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return "-";
  return new Date(epochMs).toLocaleString();
}

interface MetricValueInput {
  readonly availability: string;
  readonly unlimited?: boolean | null | undefined;
  readonly valueText: string | null;
  readonly unit: string;
}

/** An unavailable or missing value is "unknown", never zero. */
export function formatMetricValue(metric: MetricValueInput): string {
  if (metric.availability !== "available") return "unknown";
  if (metric.unlimited === true) return "unlimited";
  if (metric.valueText === null || metric.valueText === "") return "unknown";
  return metric.unit === "" ? metric.valueText : `${metric.valueText} ${metric.unit}`;
}
