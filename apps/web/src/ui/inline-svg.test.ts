import { expect, test } from "bun:test";

import { inlineSvg } from "./inline-svg.ts";

test("strips the prolog, comments and root size, and hides the mark", () => {
  const out = inlineSvg(
    '<?xml version="1.0"?><!-- note --><svg width="10" height="10" viewBox="0 0 1 1"><path width="3" d="M0"/></svg>',
    false,
  );
  expect(out).toBe(
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 1 1"><path width="3" d="M0"/></svg>',
  );
});

test("monochrome marks follow currentColor", () => {
  expect(inlineSvg('<svg viewBox="0 0 1 1"><path fill="#000" d="M0"/></svg>', true)).toContain(
    'fill="currentColor"',
  );
  expect(
    inlineSvg('<svg viewBox="0 0 1 1"><style>.a{fill: #26251e;}</style></svg>', true),
  ).toContain("fill: currentColor;");
  expect(inlineSvg('<svg viewBox="0 0 1 1"><path d="M0"/></svg>', true)).toContain(
    'fill="currentColor" viewBox',
  );
});

test("keeps brand colours when not monochrome", () => {
  expect(inlineSvg('<svg viewBox="0 0 1 1"><path fill="#D97757" d="M0"/></svg>', false)).toContain(
    'fill="#D97757"',
  );
});
