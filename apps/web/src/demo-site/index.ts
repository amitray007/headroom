import { createDemoFetch } from "./fetch.ts";
import { isEmbedded, startEmbedBridge } from "./embed.ts";

export { DemoBanner } from "./banner.tsx";

/** Answer `/api/` in the page and, inside the landing page's iframe, start listening to it. Run before the first render. */
export function installDemoSite(): void {
  window.fetch = createDemoFetch(window.fetch.bind(window), window.location.origin);
  if (isEmbedded(window.location.search)) startEmbedBridge();
}
