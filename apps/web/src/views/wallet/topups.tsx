import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { BrandMark, PencilIcon, PlusIcon, RadarIcon, TrashIcon } from "../../icons.tsx";
import { accountName, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { formatNumber } from "@headroom/view-model/present";
import { dayLabel } from "@headroom/view-model/wallet-dates";
import type { WalletTopUp } from "@headroom/view-model/wallet";

import { Button } from "../../ui/button.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { Pill } from "../../ui/pill.tsx";
import { figureText, originalNote } from "./amount.ts";
import { keepsCount, nextCount, pageSize } from "./paging.ts";

const askMs = 6000;
const detectedLabel = "Detected automatically from a balance change";

/** Remove one top-up. The first press asks in place, as Disconnect does; the question lapses after a few seconds. */
function RemoveTopUp(props: { readonly label: string; readonly onRemove: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!asking) return;
    cancel.current?.focus();
    const timer = setTimeout(() => setAsking(false), askMs);
    return () => clearTimeout(timer);
  }, [asking]);
  const close = (): void => {
    setAsking(false);
    requestAnimationFrame(() => root.current?.querySelector("button")?.focus());
  };
  const onKey = (event: KeyboardEvent<HTMLFieldSetElement>): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };
  return (
    <span ref={root}>
      {asking ? (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape cancels the question from any control inside it
        <fieldset className="confirm" aria-label="Confirm remove" onKeyDown={onKey}>
          <span className="q">Remove?</span>
          <button ref={cancel} className="btn sm" type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="btn sm primary"
            type="button"
            aria-disabled={removing}
            onClick={() => {
              if (removing) return;
              setRemoving(true);
              props.onRemove().then(
                () => setRemoving(false),
                () => {
                  setRemoving(false);
                  setAsking(false);
                },
              );
            }}
          >
            {removing ? "Removing" : "Remove"}
          </button>
        </fieldset>
      ) : (
        <Button variant="quiet" size="sm" aria-label={props.label} onClick={() => setAsking(true)}>
          <TrashIcon />
        </Button>
      )}
    </span>
  );
}

function TopUpRow(props: {
  readonly topUp: WalletTopUp;
  readonly connection: OverviewConnection | undefined;
  readonly onRemove: () => Promise<void>;
  readonly onEdit: () => void;
}) {
  const { topUp, connection } = props;
  const note = topUp.amount === null ? null : originalNote(topUp.amount);
  const name =
    connection === undefined
      ? "Removed account"
      : `${providerName(connection.provider)} · ${accountName(connection)}`;
  return (
    <li className="w-row w-topup">
      <span className="w-date num">
        {dayLabel(topUp.date)}
        {topUp.source === "detected" ? (
          <span className="w-detected" title={detectedLabel}>
            <RadarIcon />
            <span className="sr">{detectedLabel}</span>
          </span>
        ) : null}
      </span>
      <span className="w-account">
        {connection === undefined ? null : <BrandMark provider={connection.provider} />}
        <span className="w-name">{name}</span>
      </span>
      <span className="w-credits num" data-label="Credits">
        {topUp.credits === null ? (
          <span className="muted">—</span>
        ) : (
          formatNumber(topUp.credits, Number.isInteger(topUp.credits) ? 0 : 2)
        )}
      </span>
      <span className="w-paid">
        {topUp.kind === "free" ? (
          <Pill tone="quiet">Free</Pill>
        ) : topUp.amount === null ? (
          // Paid with no price entered, as a detected top-up is: unknown, never zero.
          <span className="muted">Price not set</span>
        ) : (
          <span className="w-cost">
            <span className="w-figure num">{figureText(topUp.amount)}</span>
            {note === null ? null : <span className="muted num">{note}</span>}
          </span>
        )}
      </span>
      <span className="w-note-text muted">
        {topUp.note}
        {topUp.expiresOn === null ? null : (
          <span className="w-expiry">{`${topUp.note === null ? "" : " · "}Expires ${dayLabel(topUp.expiresOn)}`}</span>
        )}
      </span>
      <span className="w-act">
        <Button
          variant="quiet"
          size="sm"
          aria-label={`Edit top-up of ${dayLabel(topUp.date)} for ${name}`}
          onClick={props.onEdit}
        >
          <PencilIcon />
        </Button>
        <RemoveTopUp
          label={`Remove top-up of ${dayLabel(topUp.date)} for ${name}`}
          onRemove={props.onRemove}
        />
      </span>
    </li>
  );
}

/** Every top-up, newest first, in one bordered group under a column header row. */
export function TopUpsSection(props: {
  readonly topUps: readonly WalletTopUp[];
  readonly connections: readonly OverviewConnection[];
  readonly onRemove: (id: string) => Promise<void>;
  readonly onEdit: (topUp: WalletTopUp) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const sentinel = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<readonly string[]>([]);
  const total = props.topUps.length;
  const ids = props.topUps.map((topUp) => topUp.id);
  // A different book starts over at the first page; one top-up more or less keeps the place.
  if (ids.length !== seen.length || ids.some((id, index) => id !== seen[index])) {
    setSeen(ids);
    if (!keepsCount(seen, ids)) setLimit(pageSize);
  }
  const shown = Math.min(limit, total);
  // Scrolling near the end loads the next page. The Show More button covers keyboards and no observer.
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || shown >= total || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((count) => nextCount(Math.min(count, total), total));
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, total]);
  const byId = new Map(props.connections.map((connection) => [connection.id, connection]));
  return (
    <section className="provider w-topups" aria-labelledby="w-topups-title">
      <header>
        <h2 id="w-topups-title">Top-Ups</h2>
      </header>
      {failed ? (
        <p className="w-save-error" role="alert">
          Could not remove the top-up. Nothing was changed.
        </p>
      ) : null}
      {props.topUps.length === 0 ? (
        <div className="w-card">
          <EmptyState compact icon={<PlusIcon />} title="No Top-Ups Yet">
            Add one when you buy or receive credits.
          </EmptyState>
        </div>
      ) : (
        <div className="w-card">
          <div className="w-colhead">
            <span>Date</span>
            <span>Account</span>
            <span>Credits</span>
            <span>Price</span>
            <span>Note</span>
            <span />
          </div>
          <ul className="w-rows">
            {props.topUps.slice(0, shown).map((topUp) => (
              <TopUpRow
                key={topUp.id}
                topUp={topUp}
                connection={byId.get(topUp.connectionId)}
                onEdit={() => props.onEdit(topUp)}
                onRemove={() =>
                  props.onRemove(topUp.id).then(
                    () => setFailed(false),
                    (cause: unknown) => {
                      setFailed(true);
                      throw cause;
                    },
                  )
                }
              />
            ))}
          </ul>
          {total <= pageSize ? null : (
            <div className="w-more" ref={sentinel}>
              <span className="muted num">
                Showing {shown} of {total}
              </span>
              {shown >= total ? null : (
                <Button
                  size="sm"
                  onClick={() => setLimit((count) => nextCount(Math.min(count, total), total))}
                >
                  Show More
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
