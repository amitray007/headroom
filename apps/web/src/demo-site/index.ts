import { createDemoFetch } from "./fetch.ts";
import { isEmbedded, startEmbedBridge } from "./embed.ts";

export { DemoBanner } from "./banner.tsx";

/** The address without a trailing `index.html`, so `/demo/index.html` reads as `/demo/`. */
export function cleanPath(pathname: string): string {
  return pathname.endsWith("/index.html") ? pathname.slice(0, -"index.html".length) : pathname;
}

/** Answer `/api/` in the page and, inside the landing page's iframe, start listening to it. Run before the first render. */
export function installDemoSite(): void {
  const { pathname, search, hash } = window.location;
  if (cleanPath(pathname) !== pathname) {
    window.history.replaceState(window.history.state, "", cleanPath(pathname) + search + hash);
  }
  window.fetch = createDemoFetch(window.fetch.bind(window), window.location.origin);
  if (isEmbedded(window.location.search)) startEmbedBridge();
}
