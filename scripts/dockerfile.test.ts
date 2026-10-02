import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Every workspace package.json must be in the install layer, or `bun install --frozen-lockfile` fails in the image. */
test("the Dockerfile copies every workspace manifest before installing", async () => {
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  const missing: string[] = [];
  for (const pattern of manifest.workspaces) {
    for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      if (!dockerfile.includes(`COPY ${path} ${path}`)) missing.push(path);
    }
  }
  expect(missing).toEqual([]);
});
