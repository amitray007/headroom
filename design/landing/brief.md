# Landing page brief

Shared brief for the landing page concepts. Each concept is one self-contained HTML file in this folder. They are disposable explorations: the owner picks one direction, and the final page is built from it.

## Goal

A visitor understands Headroom in five seconds, then uses the real app on the page without signing up. The page is exceptionally clean, quiet and distinct from generic SaaS landing pages: no gradient blobs, no stock illustrations, no feature-card grid of icons, no testimonial carousel, no pricing table.

## Product facts (use only these)

- Name: Headroom. Tagline in the README: "Every AI plan you pay for, on one screen."
- Self-hosted dashboard for Claude, Codex, Cursor, Copilot, Grok, Antigravity and Vercel AI Gateway.
- Shows live limits, resets, credits and spend for every account: 5-hour sessions, weekly pools, per-model limits, credit balances, banked resets, on-demand spend.
- Views: Overview (one panel per account), Detailed (every account sorted by how close it is to its limit), Compare (ranks accounts of one provider by room left and names the one to use next), Timeline (every limit window on a calendar, so you see when headroom comes back), Wallet (subscriptions, usage spend and top-ups in one currency, with renewals).
- Alerts: in-app notices, Telegram and signed webhooks for low limits, new and expiring resets, early resets, spend budgets and broken sign-ins.
- Automations the owner switches on: use a banked Codex reset when a limit runs out; record credit top-ups when a balance rises.
- Many accounts per provider, each with its own credentials.
- Read-only by default. Monitoring never sends a model request, redeems a reset or buys credits.
- Unknown is not zero: a figure a provider does not report shows as unknown.
- Private by design: one owner, passkeys, credentials sealed with AES-256-GCM, a master key outside the database, Privacy Mode blurs emails.
- No cloud version, on purpose: a hosted copy would hold everyone's tokens on one server someone else runs. Your server holds your tokens.
- Install: `docker run -d --name headroom -p 8080:8080 -v headroom-data:/var/lib/headroom/data -v headroom-secrets:/etc/headroom ghcr.io/amitray007/headroom:latest`, then open http://localhost:8080. Multi-arch image (amd64, arm64).
- Free and open source (MIT). Repository: https://github.com/amitray007/headroom. Sponsor: https://github.com/sponsors/amitray007.
- Honesty note for the footer: most connectors read the private endpoints the providers' own apps use; they can change without notice, and each provider's terms still apply. Headroom is not affiliated with any provider.

Do not invent numbers, users, stars, testimonials, companies or quotes.

## Voice

Plain, direct, short sentences, active voice. No hype words (seamless, powerful, revolutionary, supercharge, unlock, effortless, robust). No em dashes. Title Case for headings is not required; sentence case is fine.

## Brand

- Type: Geist and Geist Mono. Load them from Google Fonts in the concept (`Geist`, `Geist Mono`).
- Colour: the app is neutral monochrome (oklch greys) with status colours used for status only: success `oklch(78% 0.17 150)`, warning `oklch(83% 0.16 80)`, danger `oklch(75% 0.19 25)` in dark; see `apps/web/src/styles/tokens.css` for every token and the light values. One accent at most, and it must earn its place.
- Logo: `apps/web/public/favicon.svg` (a tile mark). Inline it.
- Provider marks: `apps/web/src/assets/*.svg`. Inline the ones you use. Claude and Antigravity keep their colours; the others use `currentColor`.
- Radii: panels 20px, controls 18px, pills 9999px. Spacing scale 4 8 12 16 24 32 48.
- Motion: ease-out `cubic-bezier(0.16, 1, 0.3, 1)` for entrances. Honour `prefers-reduced-motion`.
- Support light and dark (`prefers-color-scheme`, plus a toggle if the concept uses one).

## The live app embed (required)

The real app runs as a static demo build at `demo/index.html` next to the concept files (the coordinator builds it into `design/landing/demo/`). Embed it with an iframe:

```html
<iframe src="demo/index.html?embed=1#/" title="Headroom demo with synthetic data" loading="lazy"></iframe>
```

- The app is designed for a desktop width near 1280 to 1440 px. Render the iframe at a fixed logical width (for example 1440 x 900) and scale it with a CSS transform to fit its frame, keeping it interactive. On phones, show it at 390 px wide in a phone-shaped frame instead, or link to the full demo.
- Until the demo build exists, the iframe shows nothing. Put `../../docs/assets/screenshots/overview.png` (and `overview-light.png` for light) behind it as a fallback image, so the layout can be reviewed.
- Message protocol, same origin only. Post to the iframe's `contentWindow`:
  - `{ source: "headroom-site", type: "navigate", page }` where page is `overview`, `detailed`, `compare`, `timeline`, `wallet` or `connect`.
  - `{ source: "headroom-site", type: "scheme", scheme }` where scheme is `light`, `dark` or `system`.
  - The app posts `{ source: "headroom-demo", type: "ready" }` when it has rendered, and `{ source: "headroom-demo", type: "route", page }` when its view changes. Show the fallback image until `ready` arrives.
- A clear link opens the full demo in its own page: `demo/index.html` (no `embed`).

## Required content

1. Hero: headline, one supporting line, primary action (try the live demo or scroll to it), secondary action (`docker run` or GitHub).
2. The interactive dashboard, as large as the concept allows.
3. The seven providers.
4. The five views and the alerts, shown through the live app where the concept can (for example, buttons or scroll positions that navigate the embed).
5. "No cloud version" trust section: your server, your tokens.
6. Quick start with the `docker run` command and a copy button.
7. Footer: GitHub, Sponsor, MIT licence, docs link (the repository README), the honesty note.

## Quality bar

- Works from 360 px to 1920 px wide. Check 390, 768, 1280 and 1440.
- Keyboard reachable, visible focus, real buttons and links, alt text, sufficient contrast in both schemes.
- No layout shift when fonts or the iframe load.
- One file, inline CSS and JS, no framework, no build step, no external scripts except Google Fonts.
