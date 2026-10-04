import type { CSSProperties } from "react";

import { cx } from "./cx.ts";

type SkeletonKind = "line" | "title" | "bar" | "big" | "block";

/**
 * One placeholder block. It has the size of the content it stands in for, so nothing moves when the content
 * arrives. A shared shimmer sweeps all blocks in sync and stops under reduced motion. Hidden from assistive tech: the region that
 * holds blocks carries `aria-busy` and a label instead.
 */
export function Sk(props: {
  readonly kind?: SkeletonKind;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly className?: string;
}) {
  const { kind = "line", width, height } = props;
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <div className={cx("sk", kind, props.className)} style={style} aria-hidden="true" />;
}

/** What a screen reader hears while placeholders show. Put it next to the placeholders. */
export function LoadingNote(props: { readonly children: string }) {
  return <output className="sr">{props.children}</output>;
}
