import type { WebErrorPlace } from "@headroom/core/contracts";

import { api } from "../api.ts";
import { isDemoSite } from "./site.ts";

/** At most this many reports per page load, so a render loop cannot flood the server. */
const reportCap = 10;
let sent = 0;

/** Hand a caught error to the server's error tracking. The demo site has no server to tell. */
export function reportError(error: unknown, where: WebErrorPlace): void {
  if (isDemoSite || sent >= reportCap) return;
  sent += 1;
  const isError = error instanceof Error;
  void api.reportError(isError ? error.name : "Error", where, isError ? (error.stack ?? "") : "");
}

/** Report uncaught errors and unhandled rejections from anywhere in the page. */
export function reportUncaughtErrors(target: Window): void {
  target.addEventListener("error", (event) => reportError(event.error, "window"));
  target.addEventListener("unhandledrejection", (event) => reportError(event.reason, "promise"));
}
