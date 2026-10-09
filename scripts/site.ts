/**
 * Build the public site into dist-site/: the landing page (site/index.html) at the root and the demo build at demo/.
 *
 * The landing page embeds the demo and shows a skeleton of its first screen until the demo is ready. This script
 * makes that skeleton from the fresh demo build in a real browser, in both colour schemes and at both embed sizes,
 * so the demo replaces it without a shift. Run with `mise run site:build`, which builds the demo first.
 * Needs Google Chrome, or a Chromium at CHROME_PATH.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";

const repo = join(import.meta.dir, "..");
const demoBuild = join(repo, "apps/web/dist-demo");
const out = join(repo, "dist-site");

/** The logical sizes the landing page renders the embed at (`--iw` and `--ih` in site/index.html). */
const layouts = [
  { id: "d", width: 1200, height: 750 },
  { id: "m", width: 390, height: 800 },
] as const;

type Item =
  | {
      k: "svg";
      x: number;
      y: number;
      w: number;
      h: number;
      op?: number;
      color: string;
      html: string;
    }
  | {
      k: "text";
      x: number;
      y: number;
      w: number;
      h: number;
      op?: number;
      text: string;
      size: string;
      weight: string;
      ls: string;
      color: string;
    }
  | {
      k: "box";
      x: number;
      y: number;
      w: number;
      h: number;
      op?: number;
      sk: boolean;
      radius: string;
      bg?: string | null;
      borders?: (string | null)[];
      shadow?: string | null;
    };

/** Serve dist-site/ so the demo runs from an http origin, as it will on GitHub Pages. */
function serve(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const file = Bun.file(join(out, path.endsWith("/") ? `${path}index.html` : path));
      return (await file.exists())
        ? new Response(file)
        : new Response("not found", { status: 404 });
    },
  });
}

/**
 * What one layout, scheme and mode looks like. "boot" holds the session request open, so the app stays on its
 * loading frame and the probe reads its top bar. "app" lets the demo render and reads everything under the top bar.
 * A fixed Math.random gives the same synthetic accounts in every run.
 */
async function probe(
  browser: Browser,
  origin: string,
  layout: (typeof layouts)[number],
  scheme: "light" | "dark",
  mode: "boot" | "app",
): Promise<Item[]> {
  const page = await browser.newPage({
    viewport: { width: layout.width, height: layout.height },
    colorScheme: scheme,
  });
  try {
    await page.addInitScript((holdSession: boolean) => {
      Math.random = () => 0.42;
      if (!holdSession) return;
      let inner = window.fetch;
      const held: typeof fetch = (input, init) =>
        String(input instanceof Request ? input.url : input).includes("/api/auth/get-session")
          ? new Promise<Response>(() => {})
          : inner(input, init);
      Object.defineProperty(window, "fetch", {
        configurable: true,
        get: () => held,
        set: (value: typeof fetch) => {
          inner = value;
        },
      });
    }, mode === "boot");
    await page.goto(`${origin}/demo/?embed=1#/`);
    await page.waitForSelector(mode === "boot" ? ".page .sk" : ".page .panel .value");
    await page.evaluate(() => document.fonts.ready);
    // Let entrance animations and count-ups settle.
    await page.waitForTimeout(2500);
    const source = await Bun.file(join(repo, "site/skeleton-probe.js")).text();
    const items = (await page.evaluate(
      `${source}\nglobalThis.headroomSkeletonProbe(${layout.width}, ${layout.height}, "${mode}")`,
    )) as Item[];
    if (items.length === 0) throw new Error(`the ${mode} probe found nothing at ${layout.width}px`);
    return items;
  } finally {
    await page.close();
  }
}

const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** One colour for both schemes: light-dark() when they differ. */
const both = (dark: string, light: string): string =>
  dark === light ? dark : `light-dark(${light}, ${dark})`;

/** A border such as "1px solid oklch(...)" with its colour for both schemes. */
const colourOf = (border: string): string =>
  border.slice(border.indexOf(" solid ") + " solid ".length);
const border = (dark: string, light: string): string =>
  `${dark.slice(0, dark.indexOf(" solid "))} solid ${both(colourOf(dark), colourOf(light))}`;

/** Markup for one layout. The light run must have the same items, in the same order, as the dark run. */
function markup(dark: Item[], light: Item[], label: string): string {
  if (dark.length !== light.length) {
    throw new Error(`${label}: ${dark.length} items in dark, ${light.length} in light`);
  }
  return dark
    .map((d, i) => {
      const l = light.at(i);
      if (l === undefined || l.k !== d.k)
        throw new Error(`${label}: item ${i} differs between schemes`);
      let style = `left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px`;
      if (d.op !== undefined) style += `;opacity:${d.op}`;
      if (d.k === "svg" && l.k === "svg")
        return `<i style="${style};color:${both(d.color, l.color)}">${d.html}</i>`;
      if (d.k === "text" && l.k === "text") {
        style += `;line-height:${d.h}px;font-size:${d.size};font-weight:${d.weight};color:${both(d.color, l.color)}`;
        if (d.ls !== "normal") style += `;letter-spacing:${d.ls}`;
        return `<b style="${style}">${escape(d.text)}</b>`;
      }
      if (d.k !== "box" || l.k !== "box")
        throw new Error(`${label}: item ${i} has an unknown kind`);
      if (d.radius !== "0px") style += `;border-radius:${d.radius}`;
      if (d.sk) return `<s style="${style};--x:${d.x}px"></s>`;
      if (d.bg && l.bg) style += `;background:${both(d.bg, l.bg)}`;
      const sides = d.borders ?? [];
      const lightSides = l.borders ?? [];
      const first = sides[0];
      const lightFirst = lightSides[0];
      if (
        first &&
        lightFirst &&
        sides.every((b) => b === first) &&
        lightSides.every((b) => b === lightFirst)
      ) {
        style += `;border:${border(first, lightFirst)}`;
      } else {
        ["top", "right", "bottom", "left"].forEach((side, j) => {
          const b = sides[j];
          if (b) style += `;border-${side}:${border(b, lightSides[j] ?? b)}`;
        });
      }
      if (d.shadow) style += `;box-shadow:${d.shadow}`;
      return `<u style="${style}"></u>`;
    })
    .join("");
}

if (!existsSync(join(demoBuild, "index.html"))) {
  throw new Error("No demo build. Run `mise run demo:build` first, or use `mise run site:build`.");
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync(demoBuild, join(out, "demo"), { recursive: true });

const server = serve();
const browser = await chromium.launch(
  process.env["CHROME_PATH"]
    ? { executablePath: process.env["CHROME_PATH"] }
    : { channel: "chrome" },
);
let html = await Bun.file(join(repo, "site/index.html")).text();
try {
  const origin = `http://localhost:${server.port}`;
  for (const layout of layouts) {
    let fragment = "";
    for (const mode of ["boot", "app"] as const) {
      const dark = await probe(browser, origin, layout, "dark", mode);
      const light = await probe(browser, origin, layout, "light", mode);
      fragment += markup(dark, light, `${layout.width}px ${mode}`);
      console.log(`skeleton ${layout.width}px ${mode}: ${dark.length} items`);
    }
    const slot = `<div class="skel-${layout.id}"></div>`;
    if (!html.includes(slot)) throw new Error(`site/index.html has no ${slot}`);
    html = html.replace(slot, () => `<div class="skel-${layout.id}">${fragment}</div>`);
  }
} finally {
  await browser.close();
  await server.stop(true);
}
writeFileSync(join(out, "index.html"), html);
console.log(`site written to ${out}`);
