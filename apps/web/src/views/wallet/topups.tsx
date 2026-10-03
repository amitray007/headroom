import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { BrandMark, PlusIcon, TrashIcon } from "../../icons.tsx";
import { accountName, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { formatNumber } from "@headroom/view-model/present";
import { formatMoney, type TopUp } from "@headroom/view-model/wallet";

import { Button } from "../../ui/button.tsx";
import { EmptyState } from "../../ui/empty-state.tsx";
import { Pill } from "../../ui/pill.tsx";
import { dayLabel } from "./book.ts";

const askMs = 6000;

/** Remove one top-up. The first press asks in place, as Disconnect does; the question lapses after a few seconds. */
function RemoveTopUp(props: { readonly label: string; readonly onRemove: () => void }) {
  const [asking, setAsking] = useState(false);
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
          <button className="btn sm primary" type="button" onClick={props.onRemove}>
            Remove
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
  readonly topUp: TopUp;
  readonly connection: OverviewConnection | undefined;
  readonly onRemove: () => void;
}) {
  const { topUp, connection } = props;
  const name =
    connection === undefined
      ? "Removed account"
      : `${providerName(connection.provider)} · ${accountName(connection)}`;
  return (
    <li className="w-row w-topup">
      <span className="w-date num">{dayLabel(topUp.date)}</span>
      <span className="w-account">
        {connection === undefined ? null : <BrandMark provider={connection.provider} />}
        <span className="w-name">{name}</span>
      </span>
      <span className="w-credits num">
        {topUp.credits === null ? (
          <span className="muted">—</span>
        ) : (
          `${formatNumber(topUp.credits, Number.isInteger(topUp.credits) ? 0 : 2)} credits`
        )}
      </span>
      <span className="w-paid">
        {topUp.kind === "free" || topUp.price === null ? (
          <Pill tone="quiet">Free</Pill>
        ) : (
          <span className="num">
            <span className="muted">Paid </span>
            {formatMoney(topUp.price)}
          </span>
        )}
      </span>
      <span className="w-note-text muted">{topUp.note}</span>
      <span className="w-act">
        <RemoveTopUp
          label={`Remove top-up of ${dayLabel(topUp.date)} for ${name}`}
          onRemove={props.onRemove}
        />
      </span>
    </li>
  );
}

/** Every top-up, newest first, in one bordered group. */
export function TopUpsSection(props: {
  readonly topUps: readonly TopUp[];
  readonly connections: readonly OverviewConnection[];
  readonly onRemove: (id: string) => void;
}) {
  const byId = new Map(props.connections.map((connection) => [connection.id, connection]));
  const sorted = props.topUps.toSorted((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="provider w-topups" aria-labelledby="w-topups-title">
      <header>
        <h2 id="w-topups-title">Top-Ups</h2>
      </header>
      {sorted.length === 0 ? (
        <div className="w-card">
          <EmptyState compact icon={<PlusIcon />} title="No Top-Ups Yet">
            Add one when you buy or receive credits.
          </EmptyState>
        </div>
      ) : (
        <ul className="w-card">
          {sorted.map((topUp) => (
            <TopUpRow
              key={topUp.id}
              topUp={topUp}
              connection={byId.get(topUp.connectionId)}
              onRemove={() => props.onRemove(topUp.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
