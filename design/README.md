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

- Accepted: none yet; awaiting review of A and B.
- Open: A or B, or a hybrid (ledger rows on desktop, tiles on phones). Whether the Vercel credits
  arc should fill with used or remaining share. Brand marks versus monograms (SVGL assets need a
  rights check per provider). Whether a row expands inline for capabilities and run history.
- Rejected by the brief: sidebar, nav bar, header toolbar, chart-heavy dashboard blocks.
