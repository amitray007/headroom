---
name: pr-showcase
description: Fill the Showcase section of a Headroom pull request so a reviewer sees the change before reading code. Use when opening or updating a pull request that changes web or Mac views, server, connector, package or HeadroomKit behaviour.
---

# PR showcase

Every pull request that changes the interface or behaviour carries **evidence** under `## Showcase` in its description. The rule and its reason are D50; the contributor version is [CONTRIBUTING.md](../../../CONTRIBUTING.md#showcase-your-change).

Evidence uses synthetic data only: Demo Mode, the static demo build, test fixtures. A capture with a real account, token, email address or provider response never leaves the machine.

## Visual change: before and after

1. Build and serve the static demo twice, from the pull request's base in a temporary worktree (before: `git merge-base HEAD origin/<base branch>`, so a stacked pull request shows only its own layer) and from the branch (after), as the [verify web skill](../verify-web/SKILL.md) describes.
2. Capture the same view in both builds: desktop width 1280 and phone width 390, in the theme the change touches. Name each file `<branch-slug>-<view>-<width>-<theme>-before.png` or `-after.png`, so no capture overwrites another.
3. For a change in motion or a flow across views, record a short video of the after build instead of the screenshots.
4. Upload to the `pr-media` prerelease, which holds description media only:

   ```sh
   gh release view pr-media >/dev/null 2>&1 || gh release create pr-media --prerelease --latest=false \
     --title "PR media" --notes "Images for pull request descriptions. Not a release."
   gh release upload pr-media <files> --clobber
   ```

   Each file is then at `https://github.com/amitray007/headroom/releases/download/pr-media/<file>`. The release stays a prerelease and never latest: the installer, `headroom update` and mise read `releases/latest`.

5. Put the pair in a table so before and after sit side by side:

   ```markdown
   | Before | After |
   | --- | --- |
   | <img alt="Before: card" src="…/pr-media/x-card-before.png"> | <img alt="After: card" src="…/pr-media/x-card-after.png"> |
   ```

A Mac view change (`apps/macos/Headroom`, `Widgets`, `Shared`) is captured by the owner, who tests the Mac app. Write `Recording: owner to attach` under Showcase and say so in the hand-off.

## Behaviour change: what was wrong, what happens now

Lead with a figure, then one or two sentences. Choose by what changed:

| What changed | Evidence |
| --- | --- |
| A flow, an order of calls, a new fallback or state | A `mermaid` flowchart or sequence diagram, old path and new path |
| A number: time, memory, request count, size | A table with before, after and how it was measured |
| An API answer or parsed value | The request and the response before and after, from a synthetic fixture, in a fenced block |
| A bug | The failing test output before the fix and the passing output after, trimmed to the lines that matter |

GitHub renders a fenced `mermaid` block in the description; keep a diagram under about 12 nodes.

## Done when

- Showcase holds the evidence the table in CONTRIBUTING asks for: a recording or a before and an after image for a view change; a diagram, table or code block for a behaviour change.
- Every image or video opens from the description, and its `alt` text names the view and whether it is before or after.
- Nothing in the evidence comes from a real account.
