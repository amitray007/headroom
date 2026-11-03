import { describe, expect, test } from "bun:test";
import { checkShowcase, classify, showcaseSection } from "./pr-showcase.ts";

const pr = (
  body: string,
  files: string[],
  extra: Partial<Parameters<typeof checkShowcase>[0]> = {},
) => checkShowcase({ body, files, labels: [], headRef: "feat/x", author: "someone", ...extra });

const before = "![Before](https://github.com/user-attachments/assets/1111)";
const after = '<img alt="After" src="https://github.com/user-attachments/assets/2222" />';

describe("classify", () => {
  test("web and Mac views are visual", () => {
    expect(classify(["apps/web/src/dashboard/card.tsx"])).toBe("visual");
    expect(classify(["apps/web/src/auth-pages.css"])).toBe("visual");
    expect(classify(["apps/macos/Headroom/PopoverView.swift"])).toBe("visual");
    expect(classify(["apps/macos/Widgets/Ledger.swift", "apps/server/src/app.ts"])).toBe("visual");
  });

  test("server, packages and HeadroomKit are behaviour", () => {
    expect(classify(["apps/server/src/routes/app.ts"])).toBe("behaviour");
    expect(classify(["packages/connectors/cursor/src/index.ts"])).toBe("behaviour");
    expect(classify(["apps/macos/HeadroomKit/Sources/HeadroomKit/FeedClient.swift"])).toBe(
      "behaviour",
    );
  });

  test("tests, docs and CI need no showcase", () => {
    expect(
      classify([
        "apps/web/src/lib/hooks.test.tsx",
        "packages/core/src/notice-reads.test.ts",
        "apps/macos/HeadroomKit/Tests/HeadroomKitTests/FeedClientTests.swift",
        "docs/README.md",
        ".github/workflows/ci.yml",
        "scripts/site.ts",
      ]),
    ).toBe("none");
  });
});

describe("showcaseSection", () => {
  test("reads up to the next heading and drops template hints", () => {
    const body =
      "## What and why\n\nx\n\n## Showcase\n\n<!-- hint ![x](y) -->\nshown\n\n## Checklist\n- [ ] y";
    expect(showcaseSection(body)).toBe("shown");
  });

  test("keeps ### subheadings inside the section", () => {
    expect(showcaseSection("## Showcase\n### Before\na\n### After\nb")).toBe(
      "### Before\na\n### After\nb",
    );
  });

  test("is undefined without the heading", () => {
    expect(showcaseSection("## What and why\nx")).toBeUndefined();
  });
});

describe("checkShowcase", () => {
  const web = ["apps/web/src/dashboard/card.tsx"];
  const server = ["apps/server/src/routes/app.ts"];

  test("a visual change passes with before and after images", () => {
    expect(
      pr(`## Showcase\n\n| Before | After |\n| - | - |\n| ${before} | ${after} |`, web).problems,
    ).toEqual([]);
  });

  test("a visual change passes with one recording", () => {
    expect(
      pr("## Showcase\n\nhttps://github.com/user-attachments/assets/3333-abcd\n", web).problems,
    ).toEqual([]);
    expect(
      pr('## Showcase\n<video src="https://example.com/a.mp4"></video>', web).problems,
    ).toEqual([]);
  });

  test("a visual change fails with one image, a diagram or nothing", () => {
    expect(pr(`## Showcase\n${after}`, web).problems).toHaveLength(1);
    expect(pr("## Showcase\n```mermaid\ngraph LR\nA-->B\n```", web).problems).toHaveLength(1);
    expect(pr("## What and why\nx", web).problems[0]).toContain("## Showcase");
  });

  test("an image link inside a template comment does not count", () => {
    expect(pr(`## Showcase\n<!-- ${before} ${after} -->`, web).problems).toHaveLength(1);
  });

  test("a behaviour change passes with a diagram, a table, a code block or an image", () => {
    for (const shown of [
      "```mermaid\nflowchart LR\nA-->B\n```",
      "| | Before | After |\n|---|---|---|\n| p95 | 900 ms | 120 ms |",
      "```http\nGET /api/app/v1/feed\n```",
      after,
    ]) {
      expect(pr(`## Showcase\n\n${shown}`, server).problems).toEqual([]);
    }
  });

  test("a behaviour change fails with prose only", () => {
    expect(pr("## Showcase\n\nIt is faster now.", server).problems[0]).toContain("behaviour");
  });

  test("release-please, Dependabot and the owner's label skip the rule", () => {
    expect(
      pr("", web, { headRef: "release-please--branches--main--components--macos" }).problems,
    ).toEqual([]);
    expect(pr("", server, { author: "dependabot[bot]" }).problems).toEqual([]);
    expect(pr("", web, { labels: ["no-showcase"] }).problems).toEqual([]);
  });

  test("a null body is a missing section", () => {
    expect(
      checkShowcase({ body: null, files: server, labels: [], headRef: "x", author: "y" }).problems,
    ).toHaveLength(1);
  });
});
