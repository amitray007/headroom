/**
 * Prepare a bundled SVG file for inline use. Mirrors the mockup generator: drop the XML prolog, comments and
 * the root width and height, optionally paint the mark with currentColor, and hide it from assistive tech.
 */
export function inlineSvg(raw: string, monochrome: boolean): string {
  let svg = raw.replace(/<\?xml[^>]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  svg = svg.replace(/<svg\b[^>]*>/, (root) => root.replace(/\s(?:width|height)="[^"]*"/g, ""));
  if (monochrome) {
    svg = svg
      .replace(/fill="(?:#000|#000000|black|#0A0A0A|#0a0a0a)"/g, 'fill="currentColor"')
      .replace(/fill:\s*#[0-9a-fA-F]{3,6};/g, "fill: currentColor;");
    if (!svg.includes('fill="currentColor"') && !svg.includes("fill: currentColor")) {
      svg = svg.replace("<svg ", '<svg fill="currentColor" ');
    }
  }
  if (!svg.includes("aria-hidden")) {
    svg = svg.replace("<svg ", '<svg aria-hidden="true" focusable="false" ');
  }
  return svg.trim();
}
