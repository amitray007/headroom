import type { CSSProperties } from "react";

/** Inline style that sets CSS custom properties (names start with `--`). Numbers are written as plain numbers. */
export function cssVars(vars: Readonly<Record<string, string | number>>): CSSProperties {
  const style: CSSProperties & Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) style[name] = String(value);
  return style;
}
