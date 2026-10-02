import { barRects, ceilingRect, type LogoRect, logoSize, tilePath } from "./logo-geometry.ts";

function Bar(props: { readonly rect: LogoRect; readonly fill: string }) {
  const { x, y, width, height, radius } = props.rect;
  return (
    <rect x={x} y={y} width={width} height={height} rx={radius} style={{ fill: props.fill }} />
  );
}

/** The Headroom mark: several accounts (bars) under one limit (ceiling line). Colours come from the `--logo-*` tokens. */
export function LogoMark() {
  return (
    <svg viewBox={`0 0 ${logoSize} ${logoSize}`} aria-hidden="true" focusable="false">
      <path d={tilePath()} style={{ fill: "var(--logo-tile)" }} />
      <Bar rect={ceilingRect} fill="var(--logo-ceiling)" />
      {barRects.map((rect) => (
        <Bar key={rect.y} rect={rect} fill="var(--logo-ink)" />
      ))}
    </svg>
  );
}
