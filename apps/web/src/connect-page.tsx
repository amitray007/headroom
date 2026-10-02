import { useCallback, useRef, useState } from "react";

import type { Provider } from "@headroom/core/contracts";

import { api } from "./api.ts";
import { AccountsTable } from "./connect/accounts-table.tsx";
import "./connect/connect.css";
import { ConnectFlow } from "./connect/flow.tsx";
import { CardsSkeleton } from "./connect/skeletons.tsx";
import { useLoad } from "./lib/load.ts";
import { BrandMark, PlugIcon } from "./icons.tsx";
import { providerName } from "./lib/labels.ts";
import { useSettings } from "./lib/settings.tsx";
import { cx } from "./ui/cx.ts";
import { EmptyState } from "./ui/empty-state.tsx";
import { ErrorNotice } from "./ui/error-notice.tsx";
import { prefersReducedMotion } from "./ui/motion.ts";
import { Sk } from "./ui/skeleton.tsx";

/** Card order, as in the approved mockup. */
const cardOrder: readonly Provider[] = [
  "claude",
  "codex",
  "cursor",
  "copilot",
  "grok",
  "antigravity",
  "vercel_ai_gateway",
];

function orderOf(provider: Provider): number {
  return cardOrder.indexOf(provider);
}

/** Pick a provider and sign in, then see every connected account. With `reconnectId`, signs an existing account in again. */
export function ConnectPage(props: { readonly reconnectId?: string }) {
  const { reconnectId } = props;
  const providers = useLoad(() => api.providers(), "providers");
  const overview = useLoad(() => api.overview(), "overview");
  const existing = useLoad(
    () => (reconnectId === undefined ? Promise.resolve(null) : api.connection(reconnectId)),
    `reconnect:${reconnectId ?? ""}`,
  );
  const [picked, setPicked] = useState<Provider | null>(null);
  // Choosing a card again starts a fresh sign-in, so each choice gets its own run number.
  const [run, setRun] = useState(0);
  const flowRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const { reload } = overview;
  const { loaded: settingsLoaded } = useSettings();

  const entries = (providers.data?.providers ?? []).toSorted(
    (a, b) => orderOf(a.provider) - orderOf(b.provider),
  );
  const lockedProvider = existing.data?.connection.provider;
  const active = reconnectId === undefined ? picked : (lockedProvider ?? null);
  const methods = entries.find((entry) => entry.provider === active)?.methods ?? [];

  const choose = (provider: Provider): void => {
    setPicked(provider);
    setRun((count) => count + 1);
    // Wait a frame so the flow panel exists before scrolling to it.
    requestAnimationFrame(() =>
      flowRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      }),
    );
  };

  const connected = useCallback(() => {
    reload();
    // The first refresh runs a moment after the sign-in; load again to catch its limits.
    setTimeout(reload, 2500);
  }, [reload]);

  const close = useCallback(() => {
    if (reconnectId !== undefined) {
      window.location.hash = "#/";
      return;
    }
    setPicked(null);
    cardsRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, [reconnectId]);

  const reconnecting = reconnectId !== undefined;
  const name = lockedProvider === undefined ? "" : providerName(lockedProvider);
  const naming = reconnecting && existing.data === null && existing.error === null;
  return (
    <div className="connect-page">
      <div className="intro">
        {naming ? (
          <h1 className="sk-slot" aria-busy="true" aria-label="Reconnect">
            <Sk kind="big" width={240} height={33} />
          </h1>
        ) : (
          <h1>{reconnecting ? `Reconnect ${name}`.trim() : "Connect an Account"}</h1>
        )}
        <p>
          {reconnecting
            ? "Sign in again to restore this account."
            : "Choose a provider. You only sign in once."}
        </p>
      </div>
      {existing.error === null ? null : (
        <div className="cards-note">
          <ErrorNotice busy={existing.pending} onRetry={existing.reload}>
            Headroom could not load this account. Check that it is running and try again.
          </ErrorNotice>
        </div>
      )}
      {providers.data === null && providers.error !== null ? (
        <div className="cards-note">
          <ErrorNotice busy={providers.pending} onRetry={providers.reload}>
            Headroom could not load the providers. Check that it is running and try again.
          </ErrorNotice>
        </div>
      ) : null}
      {!reconnecting && providers.data === null && providers.error === null ? (
        <CardsSkeleton />
      ) : null}
      {!reconnecting && providers.data !== null && entries.length === 0 ? (
        <div className="cards-note">
          <EmptyState framed icon={<PlugIcon />} title="No Providers Switched On">
            None are switched on in the server settings. Turn one on there, restart Headroom, and it
            appears here.
          </EmptyState>
        </div>
      ) : null}
      {reconnecting || entries.length === 0 ? null : (
        <div ref={cardsRef} className={cx("cards", picked !== null && "picked")}>
          {entries.map((entry) => (
            <button
              key={entry.provider}
              type="button"
              className="card"
              aria-pressed={picked === entry.provider}
              onClick={() => choose(entry.provider)}
            >
              <span className="head">
                <BrandMark provider={entry.provider} size={24} />
                {providerName(entry.provider)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div ref={flowRef} className="flow-anchor">
        {active !== null && methods.length > 0 ? (
          <ConnectFlow
            key={`${active}:${run}`}
            provider={active}
            methods={methods}
            reconnectId={reconnectId}
            connections={overview.data?.connections ?? []}
            onClose={close}
            onConnected={connected}
          />
        ) : null}
      </div>
      <AccountsTable
        connections={overview.data?.connections ?? []}
        status={
          overview.data === null
            ? overview.error === null
              ? "loading"
              : "failed"
            : settingsLoaded
              ? "ready"
              : "loading"
        }
        retrying={overview.pending}
        reload={reload}
      />
    </div>
  );
}
