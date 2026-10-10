# Public site

The landing page for Headroom, with the demo app inside it. GitHub Pages serves it after each release. The decision is D35 in the [decision register](../docs/decisions/README.md).

| File | What it is |
| --- | --- |
| `index.html` | The landing page: one file, inline CSS and JavaScript, no framework, no build step of its own |
| `media/` | The launch film (`headroom-launch.mp4`, no burned-in captions), its poster and its captions (`.vtt`). The Watch the film button in the hero opens it in a dialog. `media/launch-video/render.sh launch` in the repository root writes these files; see [media/README.md](../media/README.md) |
| `og.png` | The link preview image, 1200 x 630, for `og:image`. It is the repository's social preview (`docs/assets/social-preview.png`) cut to the Open Graph ratio |
| `skeleton-probe.js` | Runs in the demo page during the build and reads the layout for the skeleton |
| `../scripts/site.ts` | The build: copies the demo, generates the skeleton, writes `dist-site/` |

## Build and preview

```sh
mise run site:build
python3 -m http.server 8000 -d dist-site
```

Then open http://localhost:8000. The build needs Google Chrome. To use another Chromium, set `CHROME_PATH`.

Opening `site/index.html` directly shows the page without the demo and with an empty skeleton.

## The embed

The page shows the demo (`demo/?embed=1`) in an iframe at a fixed logical size and scales it to fit: 1200 x 750 on wide screens, 390 x 800 on phones. The two pages talk by `postMessage` on the same origin only:

| From | Message | Effect |
| --- | --- | --- |
| Site | `{ source: "headroom-site", type: "navigate", page }` | The demo opens `overview`, `detailed`, `compare`, `timeline`, `wallet` or `connect` |
| Site | `{ source: "headroom-site", type: "scheme", scheme }` | The demo uses `light`, `dark` or `system` |
| Demo | `{ source: "headroom-demo", type: "ready" }` | The demo has rendered. The page fades it in over the skeleton |
| Demo | `{ source: "headroom-demo", type: "route", page }` | The visitor changed view inside the demo. The page scrolls to that step of the tour |

Scrolling the tour sends `navigate`. A view change inside the demo scrolls the page to the matching step, so the two never disagree.

## The skeleton

Until `ready` arrives, the frame shows a skeleton with the same size and scale as the iframe. `scripts/site.ts` makes it from the demo build in headless Chrome, so it always matches the current dashboard:

- The top bar comes from the app's own loading frame, read while the session request is held open.
- Everything under it comes from the demo's first screen, with every word, number and icon turned into a placeholder and meter fills left out.
- Both colour schemes are read, and each colour is written as `light-dark()`, so the page's theme switch also applies to the skeleton.

The build fails if the demo no longer has the elements the probe reads (`.page > header.top`, `.sk` in the loading frame, `.panel .value` in the overview). Fix the probe in the same change as the dashboard.

## Writing for the page

Use plain, short sentences, one per line where the design sets them as lines. Do not invent numbers, users or quotes. The footer keeps the note that Headroom reads private endpoints and is not affiliated with any provider.
