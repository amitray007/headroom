# Headroom design notes

Working notes for the single-page quota view. Mockups live in `mockups/`; renders in
`mockups/renders/`. Nothing here is implemented yet. Product rules in `docs/product.md` win over
anything below.

## Brief (2026-10-02)

One page that shows every connected account and its limits, resets and balances. No sidebar,
no top navigation, no dashboard chrome. The view of session and weekly limits must be the
attractive part. Monitoring is read-only; the one mutating action (Codex reset-credit consume)
stays behind the actions flag and an explicit confirmation.

## View the mockups

```sh
python3 -m http.server 18610 -d design/mockups
open http://localhost:18610/a-ledger.html
```

Add `?scheme=light` or `?scheme=dark` to force an appearance. Data is synthetic. Both pages
share `headroom.css` for tokens and the bar, pip, tag and notice primitives.

| Mockup | Idea | Reads best for |
| --- | --- | --- |
| `a-ledger.html` | One row per account, limits as aligned bars with a reset column | Comparing accounts at a glance, dense, scales to many accounts |
| `b-tiles.html` | One tile per account, window buckets as 270° arcs, facts at the foot | A friendlier look, big numbers, phones |
| `c-panels.html` | Provider sections, one panel per account, meters as display numbers over thick pill bars, facts behind a hairline | Superseded by D |
| `d-panels.html` | D: every figure is a cell (window meters and big-number facts) in a wrapping row that never leaves a hole; status pills; segmented one-accent bars with legends; details behind a header toggle; logo lockup | Current direction |
| `d-states.html` | D's states and primitives: status pills, buttons and hold-to-confirm, skeleton, never collected, list error, empty, over the limit | Superseded by E |
| `e-panels.html` | E: D plus provider accents and brand marks, a footer with last refresh and live Refresh, Pause and Disconnect actions, a working hold-to-confirm, an account menu with appearance switch, and no technical tables. CSS, JS and marks are inlined so the published copy renders on its own | Current direction. Interactive: click Refresh, Pause, Disconnect, hold the reset button, open the avatar menu |
| `e-states.html` | E's states, buttons, provider marks with their accents, skeleton, never collected, list error, empty, over the limit | Review alongside E |
| `e-connect.html` | Connect page: provider cards with brand marks, then every step state (device code, paste redirect, API key, checking, connected) | Review alongside E |
| `logo.html` | Four logo concepts at 64, 32, 16 px, in a lockup and inverted | Concept 4 "Ledger" is used in D |

D is built from `structure.md`, which in turn rests on `research/data-inventory.md` (what the
connectors emit) and `research/arc-ui.md` (Arc UI's tokens, components, blocks and motion).
Mockups A to D stay for comparison. Add `&motion=off` to a D or E page URL for a still render.

E follows Arc's own agent skill files (`https://uiarc.dev/r/skills/arc/*.md`, read on 2026-10-02):
verb-plus-object buttons, sentence case, one primary per surface, confirm in place, status with a
label, skeleton in the final layout, third-party marks in their real colours, hover on fine
pointers only, press 0.97 with a spring release, exits faster than enters. The one Arc rule we
reject is the removal of focus rings.

## What C takes from Arc UI

Arc's polish comes from a few repeatable decisions, not from its components:

- **Layered surfaces.** Page, panel, muted fill and raised, each one step apart in oklch
  lightness. Panels are one step lighter than the page in dark mode, not black on black.
- **One hairline weight**, subtle inside a panel and slightly stronger at its edge. No stacked
  borders; a hairline separates the facts row from the meters.
- **Big display numbers** with the unit at body size in secondary color. Labels at 14/500,
  captions at 13 secondary, hints at 12 muted. Two weights only.
- **Thick pill meters** (10 px) on a track mixed from the foreground at 9%. Segments in one hue
  at stepped alpha, never two hues.
- **Generous radii** (12 px controls, 20 px panels) and 24 px panel padding.
- **Semantic roles only** in components: `--surface`, `--text-secondary`, `--accent`,
  `--warning`. Raw values live once in `panels.css`.
- Sentence case, no eyebrow labels, no decorative color.

## Several accounts per provider

A provider is a section with its mark, name and account count. Each linked account is its own
panel under it, named by its label and plan, with its own state, data age and chips (`private`,
scope such as `member`). Panels of one provider sit 12 px apart; providers sit 48 px apart, so
spacing does the grouping. Meter columns are fixed thirds, so bars align across every panel.

## Visual rules the mockups propose

- A **window bar or arc** fills with the provider-reported used share. A thin **tick** marks how
  far the window has elapsed. Fill ahead of the tick means the account is burning faster than
  the window renews. This is the "headroom" signal and the only derived visual.
- Neutral fill until 70%, amber from 70%, red from 90%. Color is paired with the number.
- **Unknown is hatched**, never an empty bar. Unlimited shows `∞ unlimited`, never a bar.
- Percentages, requests, credits, money and reset counts keep their own units and never share a
  scale. Credits are "credits", not dollars.
- A **reset inventory** is a row of pips plus a count, separate from the bucket's reset time.
- The reset column answers "when": relative for under a day, weekday plus time for a week.
- State lives in one dot and the data age. Stale turns the age amber. Reconnect appears inline
  with its reason and keeps the last snapshot visible but dimmed. Partial shows what is missing
  and why in the row itself.
- `private` tag marks a private-interface connection; official connections carry no tag.
- The top line holds the wordmark, account count, global data age and two text links. Connect is
  the last row or tile, not a header button.
- Type: Geist for text, Geist Mono with tabular figures for every number. Light and dark follow
  the OS.

## Component libraries considered

| Library | Fit | Notes |
| --- | --- | --- |
| [Arc UI](https://uiarc.dev) | Gauge, Progress, Usage meter, Animated counter are the right shapes | Plain TSX plus CSS modules, no Tailwind, Vite supported. Depends on `motion` and `lucide-react`. Licence not stated on the site; check the exact files before copying. |
| [beUI](https://beui.dev) | Only Number Animation is relevant | Needs Tailwind 4 and Motion; the web app has neither. Not worth the foundation change for one component. |

Recommendation: hand-write the bar, arc and pip primitives in CSS as the mockups do, borrow
Arc UI's `role="meter"` and threshold-tone patterns, and revisit a motion dependency only if
animated numbers prove worth it.

## Decision log

- 2026-10-02: A and B reviewed. Feedback: not enough detail and visual cleanness compared with
  Arc UI; several accounts per provider must be first-class. C built in response.
- 2026-10-02, later: deep Arc UI survey and data inventory written; `structure.md` drafted; D
  built and audited three times (class collision broke fact cells, comma numbers showed NaN,
  window labels sat too far from their label, Details sat on its own line, plus icon unsized,
  Vercel decimals rounded). All fixed. Every panel now has a Details toggle in its header.
- 2026-10-02, review of D: drop the technical tables (capabilities, connector, signed in by), keep
  the last refresh; show Refresh, Pause and Disconnect with motion; add Connect and an account
  avatar; make it more colourful with provider marks; do not draw data the account cannot have
  (Vercel spend without Pro) but keep data that can still arrive. E built in response.
- E decisions: provider accent colours the fill of that provider's meters (Claude coral, Codex
  green, Cursor sky, Copilot violet, Grok orange, Antigravity blue, Vercel neutral); thresholds
  still override with warning and danger. `not_authorized` and `unsupported` rows are omitted and
  the partial chip names them; `unknown` and `temporarily_unavailable` rows draw hatched with
  "not reported in the last refresh". Published HTML inlines its CSS and JS because the viewer
  does not load sibling files (D's bars were invisible there).
- Accepted: none formally yet; E is the direction to iterate on.
- Open: Whether a credits meter fills with used or remaining share. Brand marks versus monograms
  (SVGL assets need a rights check per provider). Whether a panel expands inline for
  capabilities and run history. Whether the display number should be the remaining share
  ("58% left") instead of the used share.
- Rejected by the brief: sidebar, nav bar, header toolbar, chart-heavy dashboard blocks.
