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
| `c-panels.html` | Provider sections, one panel per account, meters as display numbers over thick pill bars, facts behind a hairline | Current direction. Several accounts per provider, Arc UI level of finish |

Mockup C supersedes A and B. They stay for comparison.

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
- Accepted: none formally yet; C is the direction to iterate on.
- Open: Whether a credits meter fills with used or remaining share. Brand marks versus monograms
  (SVGL assets need a rights check per provider). Whether a panel expands inline for
  capabilities and run history. Whether the display number should be the remaining share
  ("58% left") instead of the used share.
- Rejected by the brief: sidebar, nav bar, header toolbar, chart-heavy dashboard blocks.
