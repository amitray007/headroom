import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { createPortal } from "react-dom";

import { BrandMark } from "../../icons.tsx";
import { cx } from "../../ui/cx.ts";
import { Segmented } from "../../ui/segmented.tsx";
import { Select, type SelectOption } from "../../ui/select.tsx";
import type { AccountSeries } from "./series.ts";

/**
 * Shared parts of the Analytics cards: a width hook, the headline that swaps on hover, the one tooltip, the
 * account filter and the usage lanes. Every card reads the same way because these are drawn once.
 */

export const hour = 3_600_000;
export const day = 24 * hour;
/** The filter value for every account; account ids never take this form. */
const allAccounts = "__all__";

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Width of an element in pixels, kept current. Zero until the first layout. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    setWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export interface Line {
  readonly big: string;
  readonly cap: ReactNode;
}

/**
 * A value that only its readers re-render for. Hover state lives here, so moving the pointer redraws the headline
 * and the tooltip, never the chart with its hundreds of marks.
 */
interface Slot<T> {
  readonly get: () => T;
  readonly set: (next: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

function createSlot<T>(initial: T): Slot<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useSlot<T>(initial: T): Slot<T> {
  const [slot] = useState(() => createSlot(initial));
  return slot;
}

function useSlotValue<T>(slot: Slot<T>): T {
  return useSyncExternalStore(slot.subscribe, slot.get, slot.get);
}

function LiveHeadline(props: { readonly slot: Slot<Line | null>; readonly base: Line }) {
  const lit = useSlotValue(props.slot);
  return <Headline line={lit ?? props.base} />;
}

/** The headline a card opens with, and the detail that replaces it while the pointer rests on a mark. */
export function useHeadline(base: Line): {
  readonly node: ReactNode;
  readonly show: (line: Line) => void;
  readonly clear: () => void;
} {
  const slot = useSlot<Line | null>(null);
  const show = useCallback((line: Line) => slot.set(line), [slot]);
  const clear = useCallback(() => slot.set(null), [slot]);
  const { big, cap } = base;
  const node = useMemo(() => <LiveHeadline slot={slot} base={{ big, cap }} />, [slot, big, cap]);
  return useMemo(() => ({ node, show, clear }), [node, show, clear]);
}

interface TipState {
  readonly x: number;
  readonly y: number;
  readonly title: ReactNode;
  readonly body: ReactNode;
}

function LiveTip(props: { readonly slot: Slot<TipState | null> }) {
  const tip = useSlotValue(props.slot);
  if (tip === null) return null;
  return (
    <Tip x={tip.x} y={tip.y} title={tip.title}>
      {tip.body === null ? null : <p>{tip.body}</p>}
    </Tip>
  );
}

/** The one floating tooltip for a chart. `show` takes the pointer's viewport position. */
export function useTipLayer(): {
  readonly node: ReactNode;
  readonly show: (x: number, y: number, title: ReactNode, body: ReactNode) => void;
  readonly hide: () => void;
} {
  const slot = useSlot<TipState | null>(null);
  const show = useCallback(
    (x: number, y: number, title: ReactNode, body: ReactNode) => slot.set({ x, y, title, body }),
    [slot],
  );
  const hide = useCallback(() => slot.set(null), [slot]);
  const node = useMemo(() => <LiveTip slot={slot} />, [slot]);
  return useMemo(() => ({ node, show, hide }), [node, show, hide]);
}

function Headline(props: { readonly line: Line }) {
  return (
    <div className="an2-ro" aria-live="polite">
      <p className="an2-ro-big">{props.line.big}</p>
      <p className="an2-ro-cap">{props.line.cap}</p>
    </div>
  );
}

/**
 * The one floating layer. It sits in a portal at the pointer, in viewport coordinates, so no card or scroll box can
 * clip it, and it flips left or up before it would leave the window.
 */
function Tip(props: {
  readonly x: number;
  readonly y: number;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  return createPortal(
    <div
      className="an2-tip"
      data-flip={props.x > window.innerWidth - 280 || undefined}
      data-up={props.y > window.innerHeight - 160 || undefined}
      style={{ left: props.x, top: props.y }}
      aria-hidden="true"
    >
      <p className="an2-tip-title">{props.title}</p>
      {props.children}
    </div>,
    document.body,
  );
}

/**
 * Account filter: "All Accounts" or one account. A dropdown, since a row of eleven buttons would wrap into a
 * second line and crowd the card.
 */
export function AccountFilter(props: {
  readonly accounts: readonly AccountSeries[];
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
}) {
  const options: SelectOption<string>[] = [
    { value: allAccounts, label: "All Accounts" },
    ...props.accounts.map((account) => ({
      value: account.id,
      label: account.label,
      icon: <BrandMark provider={account.story.provider} />,
    })),
  ];
  return (
    <div className="an2-filter">
      <Select
        label="Accounts"
        hideLabel
        size="sm"
        value={props.value ?? allAccounts}
        options={options}
        onChange={(value) => props.onChange(value === allAccounts ? null : value)}
      />
    </div>
  );
}

/**
 * Text that may be cut short with an ellipsis. When it is, hovering it shows the whole text in the page's one
 * tooltip; when it fits, hovering does nothing.
 */
export function FullName(props: { readonly name: string; readonly className?: string }) {
  const tip = useTipLayer();
  const show = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const node = event.currentTarget;
    if (node.scrollWidth > node.clientWidth + 1)
      tip.show(event.clientX, event.clientY, props.name, null);
  };
  return (
    <>
      <span
        className={props.className}
        onPointerEnter={show}
        onPointerMove={show}
        onPointerLeave={tip.hide}
      >
        {props.name}
      </span>
      {tip.node}
    </>
  );
}

/** The account's mark and label, as rows and panels show it. */
export function AccountLabel(props: {
  readonly account: AccountSeries;
  readonly sub?: ReactNode;
  readonly strong?: boolean;
}) {
  return (
    <span className={cx("an2-who", props.strong === true && "strong")}>
      <BrandMark provider={props.account.story.provider} />
      <span className="an2-who-text">
        <FullName className="an2-who-name" name={props.account.label} />
        {props.sub === undefined ? null : <span className="an2-who-sub">{props.sub}</span>}
      </span>
    </span>
  );
}

/**
 * Usage lanes: each window of an account's main limit filling to its reset, a dashed line at 100 %, and red bars
 * where it sat locked. One lane per account, on a shared time axis from `from` to `to`.
 */
export function UsageLanes(props: {
  readonly accounts: readonly AccountSeries[];
  readonly from: number;
  readonly to: number;
  readonly width: number;
  /** Left gutter for names; 0 draws marks only. */
  readonly gutter: number;
  readonly laneHeight?: number;
  /** Faded lanes, for a selection. */
  readonly dimmed?: ReadonlySet<string>;
  /** Tinted columns, such as the working hours an account was locked. */
  readonly bands?: readonly { readonly start: number; readonly end: number }[];
  readonly onHoverWindow?: (line: Line | null) => void;
  readonly onPickAccount?: (id: string) => void;
}) {
  const laneHeight = props.laneHeight ?? 30;
  const gap = 8;
  const plotWidth = Math.max(0, props.width - props.gutter);
  const x = (at: number): number =>
    ((Math.min(props.to, Math.max(props.from, at)) - props.from) / (props.to - props.from)) *
    plotWidth;
  const height = props.accounts.length * (laneHeight + gap) - gap;
  if (props.width <= 0) return null;
  return (
    <figure
      className="an2-lanes"
      aria-label="Usage per window"
      style={{ gridTemplateColumns: `${props.gutter}px ${plotWidth}px` }}
    >
      {props.gutter > 0 ? (
        <div className="an2-lane-names" style={{ rowGap: gap }}>
          {props.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className="an2-lane-name"
              style={{ height: laneHeight }}
              data-dim={props.dimmed?.has(account.id) === true || undefined}
              onClick={() => props.onPickAccount?.(account.id)}
              disabled={props.onPickAccount === undefined}
            >
              <BrandMark provider={account.story.provider} />
              <FullName name={account.label} />
            </button>
          ))}
        </div>
      ) : (
        <span />
      )}
      <svg width={plotWidth} height={height} aria-hidden="true">
        {(props.bands ?? []).map((band) => (
          <rect
            key={band.start}
            className="an2-band"
            x={x(band.start)}
            y={0}
            width={Math.max(1, x(band.end) - x(band.start))}
            height={height}
          />
        ))}
        {props.accounts.map((account, row) => {
          const top = row * (laneHeight + gap);
          const y = (used: number): number =>
            top + 2 + (laneHeight - 4) * (1 - Math.min(100, used) / 100);
          return (
            <g
              key={account.id}
              className="an2-lane"
              data-dim={props.dimmed?.has(account.id) === true || undefined}
            >
              <line className="an2-lane-base" x1={0} x2={plotWidth} y1={y(0)} y2={y(0)} />
              <line className="an2-lane-limit" x1={0} x2={plotWidth} y1={y(100)} y2={y(100)} />
              {account.curves
                .filter((curve) => curve.end > props.from && curve.start < props.to)
                .map((curve) => {
                  const points = curve.readings.filter(
                    (reading): reading is { at: number; used: number } =>
                      reading.used !== null && reading.at >= props.from && reading.at <= props.to,
                  );
                  const first = points[0];
                  const last = points.at(-1);
                  if (first === undefined || last === undefined) return null;
                  const path =
                    points
                      .map(
                        (p, i) =>
                          `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.used).toFixed(1)}`,
                      )
                      .join("") +
                    `L${x(last.at).toFixed(1)},${y(0)}L${x(first.at).toFixed(1)},${y(0)}Z`;
                  return (
                    <g key={curve.key}>
                      <path className="an2-lane-fill" d={path} />
                      {curve.hitAt !== null &&
                      curve.lockEnd !== null &&
                      curve.lockEnd > props.from ? (
                        <rect
                          className="an2-lane-lock"
                          x={x(curve.hitAt)}
                          y={y(100) - 1.5}
                          width={Math.max(2, x(curve.lockEnd) - x(curve.hitAt))}
                          height={3}
                          rx={1.5}
                        />
                      ) : null}
                      {props.onHoverWindow === undefined ? null : (
                        <rect
                          className="an2-hit"
                          x={x(curve.start)}
                          y={top}
                          width={Math.max(1, x(curve.end) - x(curve.start))}
                          height={laneHeight}
                          onPointerEnter={() =>
                            props.onHoverWindow?.({
                              big: account.label,
                              cap: `Peak ${Math.round(curve.peak)} %${curve.current ? " (open)" : ""}${
                                curve.hitAt === null ? ", never locked" : ", hit the limit"
                              }`,
                            })
                          }
                          onPointerLeave={() => props.onHoverWindow?.(null)}
                        />
                      )}
                    </g>
                  );
                })}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** A legend row under a chart. */
export function Legend(props: { readonly children: ReactNode }) {
  return <div className="an2-legend">{props.children}</div>;
}

export function Swatch(props: {
  readonly kind: "fill" | "lock" | "dot" | "line" | "dash" | "band" | "ramp";
  readonly level?: number;
}) {
  return (
    <i className="an2-sw" data-kind={props.kind} data-level={props.level} aria-hidden="true" />
  );
}

/** The view a card shows, remembered on this device. */
export function useStoredView<T extends string>(
  key: string,
  views: readonly T[],
  fallback: T,
): [T, (view: T) => void] {
  const storageKey = `headroom.analytics.${key}`;
  const [view, setView] = useState<T>(() => {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey);
    return views.find((entry) => entry === saved) ?? fallback;
  });
  const choose = useCallback(
    (next: T) => {
      setView(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Private browsing can refuse storage; the choice still holds for this visit.
      }
    },
    [storageKey],
  );
  return [view, choose];
}

/** The card's view switch, handed to whichever view is showing so it can sit beside that view's headline. */
const CardSwitch = createContext<ReactNode>(null);

/**
 * A view's first row: its headline on the left, then its own tools and the card's view switch on the right. Every
 * view starts with one, so the switch always lines up with the headline.
 */
export function CardTop(props: { readonly headline: ReactNode; readonly tools?: ReactNode }) {
  const switcher = useContext(CardSwitch);
  return (
    <div className="an2-top">
      {props.headline}
      <div className="an2-tools">
        {props.tools}
        {switcher}
      </div>
    </div>
  );
}

/**
 * One question, one card, with a switch between the views that answer it. The card has no visible heading: the
 * headline answers the question, and the switch sits at its right. The title still names the card for screen
 * readers.
 */
export function ViewCard<T extends string>(props: {
  readonly title: string;
  readonly views: readonly { readonly value: T; readonly label: string }[];
  readonly view: T;
  readonly onView: (view: T) => void;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const { title, view, onView, views } = props;
  const switcher = useMemo(
    () => <Segmented label={`${title} view`} value={view} onChange={onView} options={views} />,
    [title, view, onView, views],
  );
  return (
    <section className="an2-card" aria-label={props.title}>
      <CardSwitch value={switcher}>{props.children}</CardSwitch>
      {props.footer === undefined ? null : <p className="an2-card-foot">{props.footer}</p>}
    </section>
  );
}
