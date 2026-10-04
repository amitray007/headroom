import { useEffect, useState, type CSSProperties } from "react";

import { cx } from "./cx.ts";
import { prefersReducedMotion } from "./motion.ts";

export type BarTone = "good" | "warn" | "bad" | "neutral";

/**
 * A meter bar. `percent` is the share the fill covers, 0 to 100. The fill grows from zero once, on first
 * mount. `unknown` draws the hatch for a figure the provider did not report. `limit` hatches the track
 * from that percent on, for a cap lower than the full bar.
 */
export function Bar(props: {
  readonly percent?: number;
  readonly tone?: BarTone;
  readonly thin?: boolean;
  readonly unknown?: boolean;
  readonly limit?: number;
  /** Value announced to assistive tech when it differs from the fill, for example used while the fill shows left. */
  readonly valueNow?: number;
  readonly label: string;
}) {
  const { percent, tone, thin = false, unknown = false, limit, label } = props;
  const [grown, setGrown] = useState(() => prefersReducedMotion());
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const style: CSSProperties & Record<string, string> = {};
  if (percent !== undefined) style["--v"] = `${Math.min(100, Math.max(0, percent))}%`;
  if (limit !== undefined) style["--limit"] = `${limit}%`;
  const className = cx(
    "bar",
    tone,
    thin && "thin",
    unknown && "unknown",
    percent !== undefined && percent <= 0 && "zero",
    limit !== undefined && "hatch",
    !grown && "pre",
  );
  if (unknown || percent === undefined) {
    return (
      <>
        <span className="sr">{label}</span>
        <div className={className} style={style} aria-hidden="true" />
      </>
    );
  }
  return (
    <>
      <meter
        className="sr"
        min={0}
        max={100}
        value={props.valueNow ?? percent}
        aria-label={label}
      />
      <div className={className} style={style} aria-hidden="true">
        <span className="fill" />
      </div>
    </>
  );
}
