import { isEmbedded } from "./embed.ts";
import "./banner.css";

/** One quiet line above the app. The landing page's iframe turns it off with `?embed=1`. */
export function DemoBanner() {
  if (isEmbedded(window.location.search)) return null;
  return (
    <aside className="demo-banner" aria-label="About this demo">
      <span className="demo-banner-text">
        Demo with synthetic data.
        <span className="demo-banner-more"> Nothing here is a real account.</span>
      </span>
      <a href="https://github.com/amitray007/headroom#quick-start" target="_blank" rel="noreferrer">
        Deploy your own
      </a>
    </aside>
  );
}
