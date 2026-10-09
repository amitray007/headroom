import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** The webDir default in packages/core config; a different value means the owner chose a directory. */
export const defaultWebDir = "apps/web/dist";

/** Files from apps/web/public that sit at the site root: browsers request /favicon.ico unprompted. */
const brandFiles = new Set([
  "favicon.ico",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
]);

const contentTypes: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** URL path without the leading slash (assets/index-abc.js) to a readable file path. */
export type AssetMap = ReadonlyMap<string, string>;

let embedded: AssetMap | null = null;

/** Called once by the generated build entry, before the server starts. */
export function registerEmbeddedAssets(assets: Record<string, string>): void {
  embedded = new Map(Object.entries(assets));
}

export interface WebAssets {
  readonly kind: "embedded" | "disk";
  /** A servable file for a URL path such as /assets/app.js, or null when the path is not a known file. */
  file(urlPath: string): Response | null;
  /** The SPA shell for client-side routes. */
  index(): Response;
}

/**
 * Pick the web UI source. A directory the owner chose (webDir differs from the default) wins when it
 * holds index.html; otherwise embedded assets; otherwise the default directory, which a source run uses.
 */
export function resolveWebAssets(
  webDir: string | undefined,
  embeddedAssets: AssetMap | null = embedded,
): WebAssets | null {
  if (webDir && webDir !== defaultWebDir && hasIndex(webDir)) return fromDisk(webDir);
  if (embeddedAssets?.has("index.html")) return build("embedded", (key) => embeddedAssets.get(key));
  if (webDir && hasIndex(webDir)) return fromDisk(webDir);
  return null;
}

function hasIndex(dir: string): boolean {
  return existsSync(join(dir, "index.html"));
}

export function webUnavailableMessage(webDir: string | undefined): string {
  return `web UI not available: this build has no embedded assets and ${webDir ?? "no web directory"} has no index.html; run "bun run build" or set HEADROOM_WEB_DIR`;
}

function fromDisk(dir: string): WebAssets {
  const root = resolve(dir);
  return build("disk", (key) => {
    const path = join(root, key);
    return existsSync(path) ? path : undefined;
  });
}

function build(kind: WebAssets["kind"], find: (key: string) => string | undefined): WebAssets {
  return {
    kind,
    file(urlPath) {
      let key: string;
      try {
        key = decodeURIComponent(urlPath).replace(/^\/+/, "");
      } catch {
        return null;
      }
      if (!servable(key)) return null;
      const path = find(key);
      return path ? respond(path, key) : null;
    },
    index() {
      const path = find("index.html");
      return path ? respond(path, "index.html") : new Response("Not found", { status: 404 });
    },
  };
}

/** Only bundle files and the root brand files are served as files; every other path is the SPA shell. */
function servable(key: string): boolean {
  if (key.includes("..") || key.includes("\\") || key.includes("\0")) return false;
  return key.startsWith("assets/") || brandFiles.has(key);
}

function respond(path: string, key: string): Response {
  const file = Bun.file(path);
  const extension = key.slice(key.lastIndexOf(".") + 1);
  const cache =
    key === "index.html"
      ? "no-cache"
      : key.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";
  return new Response(file, {
    headers: {
      "content-type": contentTypes[extension] ?? (file.type || "application/octet-stream"),
      "cache-control": cache,
    },
  });
}
