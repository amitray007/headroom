import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  arcAt,
  groupParts,
  layoutArcs,
  otherKey,
  sectorPath,
  shareText,
  sumDisplay,
  thinFade,
  type Slice,
} from "./donut-geometry.ts";
import { cssVars } from "./css-vars.ts";
import { createRingMotion, type Pose, type Range } from "./donut-motion.ts";
import { prefersReducedMotion } from "./motion.ts";
import { useInView } from "./use-in-view.ts";
import "./donut-chart.css";

/** One part of a `DonutChart`. Keep `key` stable across datasets so arcs morph in place. */
export interface DonutSegment {
  readonly key: string;
  readonly label: string;
  /** The size of the part, in any one unit (minor units of money, for example). Zero or less is left out. */
  readonly value: number;
  /** The value as shown in the legend and centre, for example "$300". */
  readonly display: string;
  /** A leading mark in the legend, such as a provider logo. */
  readonly icon?: ReactNode;
}

/** Arc's defaults, in the chart's own units: the SVG scales with its container. */
const size = 208;
const thickness = 24;
const gap = 3;
const corner = 4;
const lift = 4;
/** Room outside the ring for the lift. */
const margin = 7;
const centre = size / 2;
const outer = centre - margin;
const inner = outer - thickness;
const otherLabel = "Other";

const turn = Math.PI * 2;
const round = (value: number): string => String(Math.round(value * 100) / 100);

/** Write every part's outline, fade and lift to its path. Runs once per animation frame. */
function writePaths(
  paths: ReadonlyMap<string, SVGPathElement>,
  poses: ReadonlyMap<string, Pose>,
): void {
  for (const [key, node] of paths) {
    const pose = poses.get(key);
    if (pose === undefined) {
      node.setAttribute("d", "");
      continue;
    }
    const grow = pose.lift * 2;
    const radius = outer + grow;
    node.setAttribute(
      "d",
      sectorPath({
        center: centre,
        outer: radius,
        inner: inner - pose.lift,
        start: pose.start,
        end: pose.end,
        gap,
        corner,
      }),
    );
    node.setAttribute("fill-opacity", round(thinFade(radius, pose.start, pose.end, gap)));
    const middle = ((pose.start + pose.end) / 2) * turn - Math.PI / 2;
    const distance = pose.lift * lift;
    node.setAttribute(
      "transform",
      `translate(${round(Math.cos(middle) * distance)} ${round(Math.sin(middle) * distance)})`,
    );
  }
}

function seriesColour(index: number): string {
  if (index < 4) return `var(--series-${index + 1})`;
  return `var(--series-${5 + ((index - 4) % 3)})`;
}

interface Readout {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly meta: string;
}

/**
 * Arc's donut chart, built natively: a ring of parts with a synced legend (icon, label, value, share). The centre
 * shows the total at rest and the active part while one is hovered or focused. Colours come from the chart series
 * tokens in data order. Two to six parts read best; smaller parts group into "Other".
 *
 * Keyboard: the legend is one tab stop. Arrow keys, Home and End move between rows and highlight the part; Enter
 * or Space pins the highlight, Escape clears it. The ring and centre are hidden from assistive tech, which reads
 * a table of every part with its value and share instead.
 */
export function DonutChart(props: {
  /** Accessible name of the chart. */
  readonly label: string;
  readonly segments: readonly DonutSegment[];
  /** Centre text at rest, for example "Per month" and "$657.68". */
  readonly centerLabel: string;
  readonly centerValue: string;
  readonly centerMeta?: string;
}) {
  const { label, segments, centerLabel, centerValue, centerMeta } = props;
  const slices = useMemo(() => groupParts(segments), [segments]);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const signature = slices.map((slice) => `${slice.key}:${slice.value}`).join("|");

  // A key keeps its colour from the first time it is seen, through every dataset.
  const [palette, setPalette] = useState<ReadonlyMap<string, number>>(
    () => new Map(segments.map((segment, index) => [segment.key, index])),
  );
  if (segments.some((segment) => !palette.has(segment.key))) {
    const next = new Map(palette);
    for (const segment of segments) if (!next.has(segment.key)) next.set(segment.key, next.size);
    setPalette(next);
  }
  const colourOf = (key: string): string =>
    key === otherKey ? "var(--series-other)" : seriesColour(palette.get(key) ?? 0);
  const pathKeys = [...palette.keys(), otherKey];

  // Highlight: hover or keyboard focus previews a part; a press pins it.
  const [preview, setPreview] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const candidate = preview ?? pinned;
  const active = candidate !== null && slices.some((slice) => slice.key === candidate);
  const current = active ? candidate : null;

  // The ring.
  const figure = useRef<HTMLElement>(null);
  const [paths] = useState(() => new Map<string, SVGPathElement>());
  const [motion] = useState(() => createRingMotion((poses) => writePaths(paths, poses)));
  const seen = useInView(figure);
  const arcs = useMemo(() => layoutArcs(slices), [slices]);

  // New data (or the first view) moves every part from where it is now to its place. It runs once per signature,
  // so a parent that passes a fresh array each render restarts nothing. Unmounting forgets the signature, which
  // lets a remounted chart (strict mode) set its parts again.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!seen || applied.current === signature) return;
    applied.current = signature;
    const placed = new Map(arcs.map((arc) => [arc.key, arc]));
    const targets = new Map<string, Range>();
    let edge = 0;
    for (const key of pathKeys) {
      const arc = placed.get(key);
      if (arc === undefined) {
        targets.set(key, { start: edge, end: edge });
      } else {
        targets.set(key, { start: arc.start, end: arc.end });
        edge = arc.end;
      }
    }
    motion.retarget(
      targets,
      arcs.map((arc) => arc.key),
      prefersReducedMotion(),
    );
  });

  useEffect(() => {
    motion.setLift(current, prefersReducedMotion());
  }, [current, motion]);
  useLayoutEffect(() => {
    motion.paint();
  });
  useEffect(
    () => () => {
      motion.stop();
      applied.current = null;
    },
    [motion],
  );

  const arcUnder = (event: PointerEvent<SVGSVGElement>): string | null => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return null;
    const scale = size / box.width;
    const point = {
      x: (event.clientX - box.left) * scale - centre,
      y: (event.clientY - box.top) * scale - centre,
    };
    return arcAt(arcs, point, { outer: outer + lift, inner, slack: 6 });
  };
  const onRingMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.pointerType === "mouse") setPreview(arcUnder(event));
  };
  const onRingPress = (event: PointerEvent<SVGSVGElement>): void => {
    const key = arcUnder(event);
    if (key !== null) setPinned((was) => (was === key ? null : key));
  };

  // Legend: one tab stop, arrows move between rows.
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [rover, setRover] = useState(0);
  const stop = Math.min(rover, Math.max(0, slices.length - 1));
  const onRowKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === "Escape") {
      setPinned(null);
      setPreview(null);
      return;
    }
    const last = slices.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: last,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    rows.current[(target + slices.length) % slices.length]?.focus();
  };
  const onRowBlur = (event: FocusEvent<HTMLButtonElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.closest("ul")?.contains(next) === true) return;
    setPreview(null);
  };

  // Text for each slice.
  const nameOf = (slice: Slice<DonutSegment>): string => slice.item?.label ?? otherLabel;
  const displayOf = (slice: Slice<DonutSegment>): string =>
    slice.item?.display ?? sumDisplay(slice.members) ?? `${slice.members.length} more`;
  const shareOf = (slice: Slice<DonutSegment>): string =>
    shareText(total > 0 ? slice.value / total : 0);
  const membersOf = (slice: Slice<DonutSegment>): string => {
    const names = slice.members.map((member) => member.label);
    return names.length > 2
      ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
      : names.join(" and ");
  };
  const describe = (slice: Slice<DonutSegment>): string =>
    `${nameOf(slice)}, ${displayOf(slice)}, ${shareOf(slice)}${slice.members.length > 0 ? `. Includes ${slice.members.map((member) => member.label).join(", ")}` : ""}`;

  const readouts: readonly Readout[] = [
    { key: "rest", label: centerLabel, value: centerValue, meta: centerMeta ?? "" },
    ...slices.map((slice) => ({
      key: slice.key,
      label: nameOf(slice),
      value: displayOf(slice),
      meta: `${shareOf(slice)} of total`,
    })),
  ];
  const activeIndex = current === null ? 0 : 1 + slices.findIndex((slice) => slice.key === current);
  const hasIcons = slices.some((slice) => slice.item?.icon !== undefined);

  return (
    <figure ref={figure} className="donut" aria-label={label}>
      <div className="donut-body">
        <div
          className="donut-ring"
          style={cssVars({ "--inner": `${((inner * 2) / size) * 100}%` })}
        >
          <svg
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden="true"
            focusable="false"
            data-hover={current !== null || undefined}
            onPointerMove={onRingMove}
            onPointerLeave={() => setPreview(null)}
            onPointerUp={onRingPress}
          >
            <circle
              className="donut-track"
              cx={centre}
              cy={centre}
              r={(outer + inner) / 2}
              strokeWidth={thickness}
              data-idle={!seen || total <= 0 || undefined}
            />
            {pathKeys.map((key) => (
              <path
                key={key}
                ref={(node) => {
                  if (node === null) return;
                  paths.set(key, node);
                  return () => {
                    if (paths.get(key) === node) paths.delete(key);
                  };
                }}
                className="donut-arc"
                data-dim={(current !== null && key !== current) || undefined}
                style={cssVars({ "--slice": colourOf(key) })}
              />
            ))}
          </svg>
          <div className="donut-centre" aria-hidden="true">
            {readouts.map((readout, index) => (
              <span
                key={readout.key}
                className="donut-readout"
                data-on={index === activeIndex || undefined}
                style={cssVars({ "--place": Math.sign(index - activeIndex) })}
              >
                <span className="donut-readout-label">{readout.label}</span>
                <span className="donut-readout-value">{readout.value}</span>
                <span className="donut-readout-meta">{readout.meta}</span>
              </span>
            ))}
          </div>
        </div>
        {slices.length > 0 ? (
          <ul
            className="donut-legend"
            aria-label={`${label}, parts`}
            data-icons={hasIcons || undefined}
            onPointerLeave={() => setPreview(null)}
          >
            {slices.map((slice, index) => (
              <li key={slice.key}>
                <button
                  ref={(node) => {
                    rows.current[index] = node;
                  }}
                  type="button"
                  className="donut-row"
                  tabIndex={index === stop ? 0 : -1}
                  aria-pressed={pinned === slice.key}
                  aria-label={describe(slice)}
                  data-on={slice.key === current || undefined}
                  data-pinned={slice.key === pinned || undefined}
                  style={cssVars({ "--slice": colourOf(slice.key) })}
                  onClick={() => setPinned((was) => (was === slice.key ? null : slice.key))}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setPreview(slice.key);
                  }}
                  onFocus={(event) => {
                    setRover(index);
                    if (event.currentTarget.matches(":focus-visible")) setPreview(slice.key);
                  }}
                  onBlur={onRowBlur}
                  onKeyDown={(event) => onRowKey(event, index)}
                >
                  <span className="donut-dot" aria-hidden="true" />
                  {hasIcons ? (
                    <span className="donut-icon" aria-hidden="true">
                      {slice.item?.icon}
                    </span>
                  ) : null}
                  <span className="donut-name" aria-hidden="true">
                    <span>{nameOf(slice)}</span>
                    {slice.members.length > 0 ? (
                      <span className="donut-sub">{membersOf(slice)}</span>
                    ) : null}
                  </span>
                  <span className="donut-value" aria-hidden="true">
                    {displayOf(slice)}
                  </span>
                  <span className="donut-share" aria-hidden="true">
                    {shareOf(slice)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {total > 0 ? (
        <table className="sr">
          <caption>{`${label}. ${centerLabel} ${centerValue}`}</caption>
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Value</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {slices.flatMap((slice) =>
              slice.members.length > 0
                ? slice.members.map((member) => (
                    <tr key={member.key}>
                      <th scope="row">{`${member.label} (${otherLabel})`}</th>
                      <td>{member.display}</td>
                      <td>{shareText(member.value / total)}</td>
                    </tr>
                  ))
                : [
                    <tr key={slice.key}>
                      <th scope="row">{nameOf(slice)}</th>
                      <td>{displayOf(slice)}</td>
                      <td>{shareOf(slice)}</td>
                    </tr>,
                  ],
            )}
          </tbody>
        </table>
      ) : (
        <p className="sr">{`${label}. Nothing to show.`}</p>
      )}
    </figure>
  );
}
