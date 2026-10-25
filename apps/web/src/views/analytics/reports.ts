import { readStoredView } from "./stored-view.ts";

/**
 * The reports the Analytics page switches between, in tab order, each with the span of time it reads. The page
 * shows one report at a time; this list is light so the skeleton can draw the same tabs before the charts load.
 */
export type Report = "rhythm" | "now" | "fit";

export const reports = [
  { value: "rhythm", label: "Rhythm", span: "Last 30 days" },
  { value: "now", label: "Forecast", span: "To each reset" },
  { value: "fit", label: "Plan fit", span: "Last 90 days" },
] as const satisfies readonly {
  readonly value: Report;
  readonly label: string;
  readonly span: string;
}[];

export const reportKeys: readonly Report[] = reports.map((entry) => entry.value);

/** The key `useStoredView` keeps the open report under. */
export const reportStore = "report";

/** The report opened last on this device, for the skeleton. */
export function storedReport(): Report {
  return readStoredView(reportStore, reportKeys, "rhythm");
}

/** Rhythm's views in switch order. The page opens on By Account until a device stores another pick. */
export type RhythmView = "matrix" | "weeks" | "range" | "accounts";

export const rhythmViews = [
  { value: "matrix", label: "Matrix" },
  { value: "weeks", label: "Weeks" },
  { value: "range", label: "Range" },
  { value: "accounts", label: "By Account" },
] as const satisfies readonly { readonly value: RhythmView; readonly label: string }[];

export const rhythmViewKeys: readonly RhythmView[] = rhythmViews.map((entry) => entry.value);

/** The key `useStoredView` keeps Rhythm's view under, and the view a device without one opens on. */
export const rhythmStore = "rhythm";
export const rhythmDefault: RhythmView = "accounts";

/** Rhythm's view picked last on this device, for the skeleton. */
export function storedRhythmView(): RhythmView {
  return readStoredView(rhythmStore, rhythmViewKeys, rhythmDefault);
}
