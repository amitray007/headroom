import { expect, test } from "bun:test";

import { packageReadme } from "./package-readme.ts";

const repo = "https://github.com/amitray007/headroom";
const raw = "https://raw.githubusercontent.com/amitray007/headroom";

test("relative links and images become absolute, pinned to the release tag", () => {
  const out = packageReadme(
    [
      '<img src="docs/assets/screenshots/detailed.png" alt="Detailed">',
      '<img src="apps/web/public/favicon.svg" alt="Logo">',
      "[Docs](docs/README.md) and [the licence](./LICENSE)",
      "[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)",
      "![Phone](docs/assets/screenshots/mobile-wallet.png)",
      '<a href="CONTRIBUTING.md">Contribute</a>',
    ].join("\n"),
    "1.2.3",
  );
  expect(out).toContain(`src="${raw}/v1.2.3/docs/assets/screenshots/detailed.png"`);
  expect(out).toContain(`src="${raw}/v1.2.3/apps/web/public/favicon.svg?sanitize=true"`);
  expect(out).toContain(`[Docs](${repo}/blob/v1.2.3/docs/README.md)`);
  expect(out).toContain(`[the licence](${repo}/blob/v1.2.3/LICENSE)`);
  expect(out).toContain(
    `[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](${repo}/blob/v1.2.3/LICENSE)`,
  );
  expect(out).toContain(`![Phone](${raw}/v1.2.3/docs/assets/screenshots/mobile-wallet.png)`);
  expect(out).toContain(`href="${repo}/blob/v1.2.3/CONTRIBUTING.md"`);
});

test("absolute links, page anchors and mail links stay as they are", () => {
  const text =
    "[Demo](https://headroom.theblank.club/) [Start](#quick-start) [Mail](mailto:a@example.com)";
  expect(packageReadme(text, "1.2.3")).toBe(text);
});
