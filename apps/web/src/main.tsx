import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";

import { App } from "./app.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";
import { applyStoredPrefs, browserStorage, readView } from "./lib/device-prefs.ts";
import { restoreView } from "./router.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./dashboard/dashboard.css";
import "./styles/states.css";
import "./styles/buttons.css";
import "./styles/controls.css";

// The static demo site answers /api/ in the page, so it is installed before anything asks. A normal build drops this.
// The test is written out here, not imported, so the bundler can drop the dynamic import with its chunk.
const demoSite = import.meta.env.MODE === "demo" ? await import("./demo-site/index.ts") : null;
demoSite?.installDemoSite();

// Appearance, Privacy Mode, Demo Mode and density are on the page before the first render, so nothing flashes.
const storage = browserStorage();
applyStoredPrefs(document.documentElement, storage);
// The bare root opens on the view this device used last.
restoreView(window.location, window.history, storage === null ? null : readView(storage));

// A tab left open across a deploy asks for page code whose file name changed. Reload once to get the new build; a
// second failure within a minute is a real outage and goes to the error boundary.
window.addEventListener("vite:preloadError", (event) => {
  const stamp = "headroom.preload-reload";
  try {
    const last = Number(window.sessionStorage.getItem(stamp) ?? "0");
    if (Date.now() - last < 60_000) return;
    window.sessionStorage.setItem(stamp, String(Date.now()));
  } catch {
    // Blocked storage cannot guard against a reload loop, so leave the failure to the error boundary.
    return;
  }
  event.preventDefault();
  window.location.reload();
});

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      {demoSite === null ? null : <demoSite.DemoBanner />}
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
