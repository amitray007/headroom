import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";

import { App } from "./app.tsx";
import { ErrorBoundary } from "./error-boundary.tsx";
import { applyStoredPrefs, browserStorage } from "./lib/device-prefs.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./dashboard/dashboard.css";
import "./styles/states.css";

// Appearance, Hide Details and density are on the page before the first render, so nothing flashes.
applyStoredPrefs(document.documentElement, browserStorage());

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
