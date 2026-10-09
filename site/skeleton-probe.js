// Runs inside the demo page, in a browser, for scripts/site.ts. It reads what is on screen and returns a flat
// list of boxes, text and icons, in page pixels. In "boot" mode it reads only the top bar of the app's loading
// frame. In "app" mode it reads everything under the top bar of the rendered demo and turns every word, number
// and icon into a placeholder, so the skeleton has the real layout without the real values.
const round = (n) => Math.round(n * 10) / 10;
const transparent = (c) => c === "transparent" || /(\/ 0\)|,\s*0\))$/.test(c);
const at = (r) => ({ x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) });
const placeholder = (r, radius) => ({ k: "box", sk: true, ...at(r), radius });
const chroma = (c) => {
  const match = /oklch\(\S+ (\S+)/.exec(c);
  return match ? Number.parseFloat(match[1]) : 0;
};

globalThis.headroomSkeletonProbe = (width, height, mode) => {
  const out = [];
  const onScreen = (r) =>
    r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height && r.right > 0 && r.left < width;
  const root = document.querySelector("#root");
  const header = document.querySelector(".page > header.top");
  if (!root || !header) throw new Error("the demo has no .page > header.top");

  const walk = (el, inherited) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return;
    // A layer clipped away completely, such as the fill of a hold-to-confirm button at rest.
    if (cs.clipPath.startsWith("inset(") && cs.clipPath.includes("100%")) return;
    const opacity = Math.round(inherited * Number(cs.opacity) * 100) / 100;
    const push = (item) => out.push(opacity < 1 ? { ...item, op: opacity } : item);
    const inTop = header.contains(el);
    const wrapsTop = el.contains(header) && el !== header;
    if (mode === "boot" && !inTop && !wrapsTop) return;
    if (mode === "app" && inTop) return;
    const drawn = mode === "boot" ? inTop : !wrapsTop;
    const r = el.getBoundingClientRect();

    if (el.tagName.toLowerCase() === "svg") {
      if (!onScreen(r)) return;
      if (inTop) {
        const html = el.outerHTML.replace(
          /\s(class|data-[\w-]+|aria-[\w-]+|focusable)="[^"]*"/g,
          "",
        );
        push({ k: "svg", ...at(r), color: cs.color, html });
      } else if (r.width <= 28) push(placeholder(r, "9999px"));
      return;
    }
    // The avatar is drawn from the owner's name, which the skeleton does not know yet.
    if (el.classList.contains("avatar")) {
      if (onScreen(r)) push(placeholder(r, "50%"));
      return;
    }

    const sk = el.classList.contains("sk");
    const background = transparent(cs.backgroundColor) ? null : cs.backgroundColor;
    const borders = ["Top", "Right", "Bottom", "Left"].map((side) => {
      const w = cs.getPropertyValue(`border-${side.toLowerCase()}-width`);
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const color = cs.getPropertyValue(`border-${side.toLowerCase()}-color`);
      return Number.parseFloat(w) > 0 && style !== "none" && !transparent(color)
        ? `${w} solid ${color}`
        : null;
    });
    if (drawn && onScreen(r) && (sk || background || borders.some(Boolean))) {
      if (!inTop && background && chroma(background) > 0.03) {
        // A status colour: a small dot becomes a placeholder; a meter fill is left out, so the empty track shows.
        if (r.width <= 12 && r.height <= 12) push(placeholder(r, "9999px"));
      } else {
        push({
          k: "box",
          sk,
          ...at(r),
          radius: cs.borderRadius,
          bg: sk ? null : background,
          borders,
          shadow: cs.boxShadow === "none" ? null : cs.boxShadow,
        });
      }
    }

    for (const node of el.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        walk(node, opacity);
        continue;
      }
      const text = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "").trim() : "";
      if (!drawn || text === "") continue;
      // Visually hidden text, such as a note for screen readers.
      if (r.width <= 1 || r.height <= 1 || cs.clipPath !== "none" || cs.clip !== "auto") continue;
      // A lone separator such as "·" would read as a bar.
      if (!inTop && !/[\p{L}\p{N}]/u.test(text)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (inTop) {
        const t = range.getBoundingClientRect();
        if (onScreen(t)) {
          push({
            k: "text",
            ...at(t),
            text,
            size: cs.fontSize,
            weight: cs.fontWeight,
            ls: cs.letterSpacing,
            color: cs.color,
          });
        }
        continue;
      }
      // Glyph height, centred on each line, as the app's own text placeholders are.
      const bar = round(Number.parseFloat(cs.fontSize) * 0.72);
      for (const line of range.getClientRects()) {
        if (!onScreen(line) || line.width < 2) continue;
        const centred = new DOMRect(line.left, line.top + (line.height - bar) / 2, line.width, bar);
        push(placeholder(centred, "9999px"));
      }
    }
  };

  walk(root, 1);
  return out;
};
