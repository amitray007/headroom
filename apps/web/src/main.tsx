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

// Appearance, Privacy Mode, Demo Mode and density are on the page before the first render, so nothing flashes.
const storage = browserStorage();
applyStoredPrefs(document.documentElement, storage);
// The bare root opens on the view this device used last.
restoreView(window.location, window.history, storage === null ? null : readView(storage));

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
