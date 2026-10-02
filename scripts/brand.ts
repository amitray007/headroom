/**
 * Regenerates the favicons and app icons in apps/web/public from the one mark geometry in
 * apps/web/src/ui/logo-geometry.ts. Run with `mise exec -- bun scripts/brand.ts`.
 * Needs headless Chrome: set CHROME, or it uses the macOS default and then `google-chrome`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  barRects,
  ceilingRect,
  type LogoRect,
  logoLightness,
  logoSize,
  tilePath,
} from "../apps/web/src/ui/logo-geometry.ts";

const outDir = join(import.meta.dir, "..", "apps", "web", "public");

/** Hex colour of a neutral OKLCH grey (chroma 0), the only kind the tokens use. */
function grey(lightnessPercent: number): string {
  const linear = (lightnessPercent / 100) ** 3;
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  const byte = Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  return `#${byte.toString(16).padStart(2, "0").repeat(3)}`;
}

const palette = {
  light: {
    tile: grey(logoLightness.light.tile),
    ink: grey(logoLightness.light.ink),
    ceiling: grey(logoLightness.light.ceiling),
  },
  dark: {
    tile: grey(logoLightness.dark.tile),
    ink: grey(logoLightness.dark.ink),
    ceiling: grey(logoLightness.dark.ceiling),
  },
};

function rect(r: LogoRect, cls: string): string {
  return `<rect class="${cls}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${r.radius}"/>`;
}

function body(tile: string): string {
  return [tile, rect(ceilingRect, "c"), ...barRects.map((r) => rect(r, "i"))].join("");
}

const squircle = `<path class="t" d="${tilePath()}"/>`;
const square = `<rect class="t" width="${logoSize}" height="${logoSize}"/>`;

function svg(scheme: "light" | "dark", tile: string, size?: number): string {
  const c = palette[scheme];
  const dimension = size === undefined ? "" : ` width="${size}" height="${size}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${logoSize} ${logoSize}"${dimension}><style>.t{fill:${c.tile}}.i{fill:${c.ink}}.c{fill:${c.ceiling}}</style>${body(tile)}</svg>`;
}

/** The tab icon: light-scheme colours, switched by the browser's colour scheme. */
function adaptiveSvg(): string {
  const d = palette.dark;
  const l = palette.light;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${logoSize} ${logoSize}"><style>.t{fill:${l.tile}}.i{fill:${l.ink}}.c{fill:${l.ceiling}}@media (prefers-color-scheme:dark){.t{fill:${d.tile}}.i{fill:${d.ink}}.c{fill:${d.ceiling}}}</style>${body(squircle)}</svg>\n`;
}

function chromePath(): string {
  const candidates = [
    process.env["CHROME"],
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => p !== undefined && existsSync(p)) ?? "google-chrome";
}

const work = mkdtempSync(join(tmpdir(), "headroom-brand-"));

async function renderPng(markup: string, size: number, file: string): Promise<Uint8Array> {
  const html = join(work, `${file}.html`);
  const png = join(work, `${file}.png`);
  await Bun.write(html, `<!doctype html><body style="margin:0">${markup}`);
  const proc = Bun.spawn(
    [
      chromePath(),
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      "--force-device-scale-factor=1",
      `--screenshot=${png}`,
      `file://${html}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  await proc.exited;
  return new Uint8Array(await Bun.file(png).arrayBuffer());
}

/** An ICO container holding PNG images, which every current browser accepts. */
function ico(images: readonly { size: number; png: Uint8Array }[]): Uint8Array {
  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((sum, i) => sum + i.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((image, index) => {
    const entry = 6 + 16 * index;
    out[entry] = image.size;
    out[entry + 1] = image.size;
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.length;
  });
  return out;
}

const manifest = {
  name: "Headroom",
  short_name: "Headroom",
  description: "Self-hosted dashboard for AI account allowances, balances and usage",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: grey(logoLightness.light.ink),
  theme_color: grey(logoLightness.light.ink),
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
};

try {
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, data: string | Uint8Array) => Bun.write(join(outDir, name), data);

  await write("favicon.svg", adaptiveSvg());
  const png16 = await renderPng(svg("light", squircle, 16), 16, "16");
  const png32 = await renderPng(svg("light", squircle, 32), 32, "32");
  await write("favicon-32.png", png32);
  await write(
    "favicon.ico",
    ico([
      { size: 16, png: png16 },
      { size: 32, png: png32 },
    ]),
  );
  // iOS rounds the corners itself, so the touch icon is a full-bleed opaque square.
  await write("apple-touch-icon.png", await renderPng(svg("light", square, 180), 180, "180"));
  await write("icon-192.png", await renderPng(svg("light", squircle, 192), 192, "192"));
  await write("icon-512.png", await renderPng(svg("light", squircle, 512), 512, "512"));
  await write("manifest.webmanifest", `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote brand assets to ${outDir}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
