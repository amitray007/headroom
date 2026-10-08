/**
 * True in the static demo site (`vite build --mode demo`): no server, Demo Mode locked on, an in-browser API.
 * Every use is written as `isDemoSite && ...` or a ternary on this constant, so a normal build folds it away.
 */
export const isDemoSite = import.meta.env.MODE === "demo";

/** The window event the app sends once the dashboard has rendered with its accounts. The embed bridge relays it. */
export const demoReadyEvent = "headroom:demo-ready";
