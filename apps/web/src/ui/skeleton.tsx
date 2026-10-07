import { useLayoutEffect, type CSSProperties } from "react";

import { cx } from "./cx.ts";

type SkeletonKind = "line" | "text" | "title" | "bar" | "big" | "block" | "ring";

// How many placeholders are on screen. A placeholder that mounts while others still show is a hand-over, such as
// the boot frame giving way to the page, or a Suspense fallback to the page's own skeleton. It must not fade in
// again, or the swap blinks.
let shown = 0;

function useHandOver(): boolean {
  const handOver = shown > 0;
  useLayoutEffect(() => {
    shown += 1;
    return () => {
      shown -= 1;
    };
  }, []);
  return handOver;
}

/**
 * One placeholder block. It has the size of the content it stands in for, so nothing moves when the content
 * arrives. `text` sits in a real text element and takes the height of its glyphs, so the line keeps the element's
 * own line height. `ring` is a donut whose band is `--sk-ring` wide. A shared shimmer sweeps all blocks in sync
 * and stops under reduced motion. Blocks fade in after a short delay, so a fast load never flashes them. Hidden
 * from assistive tech: the region that holds blocks carries `aria-busy` and a label instead.
 */
export function Sk(props: {
  readonly kind?: SkeletonKind;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly className?: string;
}) {
  const { kind = "line", width, height } = props;
  const handOver = useHandOver();
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return (
    <span
      className={cx("sk", kind, handOver && "held", props.className)}
      style={style}
      aria-hidden="true"
    />
  );
}

/** What a screen reader hears while placeholders show. Put it next to the placeholders. */
export function LoadingNote(props: { readonly children: string }) {
  return <output className="sr">{props.children}</output>;
}
