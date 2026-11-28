/* oxlint-disable no-underscore-dangle -- `_i` and `__SV` are the field names PostHog's loader reads */
import { parseRoute, viewOf } from "../router.ts";
import { isEmbedded } from "./embed.ts";

/**
 * Anonymous visit counts for the public demo only. The key is a public ingest key. Nothing is stored in the browser,
 * so no consent banner is needed, and a blocked loader changes nothing.
 */
const key = "phc_mFhU4x7B3Ze55gPVQJozu9tpkEzTtUh3kBdq2PtDi2uN";
const apiHost = "https://hd.headroom.theblank.club";

/** PostHog's loader stub: an array that queues calls until the real library, loaded from the proxy, replays them. */
type Stub = unknown[] & {
  __SV?: number;
  _i?: unknown[][];
  init?: (token: string, config: Record<string, unknown>) => void;
  capture?: (event: string, properties?: Record<string, unknown>) => void;
  register?: (properties: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    posthog?: Stub;
  }
}

function install(): Stub {
  const stub: Stub = [];
  stub._i = [];
  stub.__SV = 1;
  stub.init = (token, config) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `${apiHost}/static/array.js`;
    document.head.append(script);
    stub._i?.push([token, config]);
  };
  stub.capture = (event, properties) => void stub.push(["capture", event, properties]);
  stub.register = (properties) => void stub.push(["register", properties]);
  window.posthog = stub;
  return stub;
}

function capture(event: string, properties: Record<string, unknown>): void {
  try {
    window.posthog?.capture?.(event, {
      ...properties,
      embedded: isEmbedded(window.location.search),
    });
  } catch {
    // Analytics never breaks the demo.
  }
}

function captureView(): void {
  const view = viewOf(parseRoute(window.location.hash));
  if (view !== null) capture("demo_view", { view });
}

/** Start the anonymous analytics: page view, a `demo_view` for each view opened, and the "Deploy your own" click. */
export function startAnalytics(): void {
  try {
    const posthog = install();
    posthog.init?.(key, {
      api_host: apiHost,
      ui_host: "https://us.posthog.com",
      persistence: "memory",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      capture_exceptions: true,
      advanced_disable_flags: true,
      ip: false,
    });
    posthog.register?.({ source: "demo" });
    captureView();
    window.addEventListener("hashchange", captureView);
  } catch {
    // A blocked loader leaves the demo as it was.
  }
}

export function trackDeployClick(): void {
  capture("demo_deploy_clicked", {});
}
