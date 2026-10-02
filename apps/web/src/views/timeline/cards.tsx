import { useId, useState, type ReactNode } from "react";

import type { OverviewConnection } from "../../api.ts";
import { BrandMark } from "../../icons.tsx";
import { countdown, exactFull, type TimeStyle } from "../../lib/time.ts";
import { displayMeter } from "../../lib/tone.ts";
import { cx } from "../../ui/cx.ts";
import {
  expiresSoonMs,
  upNextGroups,
  type RunningLow,
  type SavedResets,
  type UpNextItem,
} from "./lanes.ts";
import { dayClock, shortDay } from "./range.ts";
import { kindLabel, laneName, type TipContext } from "./tips.ts";

/** The two cards under the grid: what resets next, and what needs watching. */

const rowLimit = 6;

interface Look extends TipContext {
  readonly timeStyle: TimeStyle;
}

/** A small tone bar with the figure the owner reads now; "Not Reported" when unknown. */
function Usage(props: { readonly used: number | null; readonly look: Look }) {
  const { used, look } = props;
  if (used === null) return <span className="tl-use tl-unk">Not Reported</span>;
  const shown = displayMeter(used, look.view, look.low, 0);
  return (
    <span className="tl-use" data-tone={shown.tone ?? undefined}>
      <span className="tl-mbar" aria-hidden="true">
        <i style={{ width: `${shown.fill ?? 0}%` }} />
      </span>
      <b>{`${shown.value ?? 0}%`}</b>
      <span className="tl-sr">{look.view === "left" ? " Left" : " Used"}</span>
    </span>
  );
}

/** Countdown over the short time, or the other way round under the Exact time style. */
function WhenCell(props: { readonly at: number; readonly look: Look }) {
  const { at, look } = props;
  const count = countdown(at, look.now);
  const exact = dayClock(at, look.clock);
  const first = look.timeStyle === "countdown" ? count : exact;
  const second = look.timeStyle === "countdown" ? exact : count;
  return (
    <span className="tl-when">
      <b>{first}</b>
      <span>{second}</span>
    </span>
  );
}

function Row(props: {
  readonly connection: OverviewConnection;
  readonly dim: boolean;
  readonly title?: string;
  readonly what: string;
  readonly children: ReactNode;
}) {
  const { connection } = props;
  return (
    <li className={cx(props.dim && "tl-dim")} title={props.title}>
      <BrandMark provider={connection.provider} />
      <span className="tl-what">
        <b>{laneName(connection)}</b>
        <span>{props.what}</span>
      </span>
      {props.children}
    </li>
  );
}

/** The next resets in time order under Next 24 Hours, This Week and Later; six rows, then Show All. */
export function UpNextCard(props: { readonly items: readonly UpNextItem[]; readonly look: Look }) {
  const { items, look } = props;
  const [all, setAll] = useState(false);
  const titleId = useId();
  const groups = upNextGroups(items, look.now, all ? null : rowLimit);
  return (
    <section className="tl-card" aria-labelledby={titleId}>
      <h2 id={titleId}>Up Next</h2>
      <div className="tl-card-body">
        {items.length === 0 ? <p className="tl-empty">No Resets Ahead.</p> : null}
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="tl-sub">{group.label}</h3>
            <ul>
              {group.items.map((item) => (
                <Row
                  key={item.id}
                  connection={item.connection}
                  dim={item.inactive}
                  title={exactFull(item.end, look.now, look.clock)}
                  what={`${kindLabel(item.kind)} ${item.kind === "cycle" ? "Ends" : "Resets"}`}
                >
                  <Usage used={item.used} look={look} />
                  <WhenCell at={item.end} look={look} />
                </Row>
              ))}
            </ul>
          </div>
        ))}
        {items.length > rowLimit ? (
          <button
            type="button"
            className="tl-more"
            aria-expanded={all}
            onClick={() => setAll((was) => !was)}
          >
            {all ? "Show Fewer" : `Show All ${items.length}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Windows running low with when room returns, and the banked resets with their expiries. */
export function WatchListCard(props: {
  readonly low: readonly RunningLow[];
  readonly saved: readonly SavedResets[];
  readonly look: Look;
}) {
  const { low, saved, look } = props;
  const titleId = useId();
  return (
    <section className="tl-card" aria-labelledby={titleId}>
      <h2 id={titleId}>Watch List</h2>
      <div className="tl-card-body">
        <h3 className="tl-sub">Running Low Until</h3>
        {low.length === 0 ? (
          <p className="tl-empty">Nothing Is Running Low.</p>
        ) : (
          <ul>
            {low.map((row) => (
              <Row
                key={row.id}
                connection={row.connection}
                dim={row.inactive}
                title={exactFull(row.back, look.now, look.clock)}
                what={`${row.meter.short} ${row.caption}`}
              >
                <Usage used={row.used} look={look} />
                <WhenCell at={row.back} look={look} />
              </Row>
            ))}
          </ul>
        )}
        <h3 className="tl-sub">Saved Resets</h3>
        {saved.length === 0 ? (
          <p className="tl-empty">No Saved Resets.</p>
        ) : (
          <ul>
            {saved.map((row) => {
              const first = row.expiries[0];
              const noun = row.count === 1 ? row.label : `${row.label}s`;
              return (
                <li key={row.connection.id} className={cx("tl-bankrow", row.inactive && "tl-dim")}>
                  <BrandMark provider={row.connection.provider} />
                  <span className="tl-what">
                    <b>{laneName(row.connection)}</b>
                    <span>
                      {`${row.count} ${noun}`}
                      {first === undefined
                        ? ""
                        : ` · next expires in ${countdown(first, look.now)}`}
                    </span>
                  </span>
                  {row.soon ? <span className="tl-soon">Expires Soon</span> : null}
                  <span className="tl-exps">
                    {row.expiries.map((at) => (
                      <span
                        key={at}
                        className={cx("tl-exp", at - look.now < expiresSoonMs && "tl-exp-soon")}
                        title={exactFull(at, look.now, look.clock)}
                      >
                        <i aria-hidden="true" />
                        {shortDay(at)}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
