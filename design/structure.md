# Headroom quota view: structure

The plan for the one-page quota view. Built on `research/data-inventory.md` (what the connectors
really emit) and `research/arc-ui.md` (the finish and motion we borrow). Product rules in
`docs/product.md` win over anything here.

## 1. Principles

1. One page. Every linked account, its limits, balances and resets. No sidebar, no nav bar.
2. Provider-reported figures only. Used share is a percentage; money, credits, requests and
   resets keep their own units. Nothing is summed across accounts.
3. A missing row is not drawn. An unavailable row is drawn as unknown with its reason. Zero is
   zero.
4. The one derived visual is the elapsed tick: how far the window has run, next to how much of it
   is used. Fill ahead of the tick means the account burns faster than it renews.
5. Monitoring is read-only. The only mutation is the Codex reset consume, behind the actions flag,
   a confirm step and the server's own checks.
6. Finish comes from systems: layered surfaces, one hairline weight, two type weights, a fixed
   spacing scale, semantic color roles, restrained motion with a reduced-motion fallback.

## 2. Page anatomy

```
Top line        [mark] Headroom          9 accounts · refreshed 2 min ago   Connect   Account
Provider        [CL] Claude  2 accounts
  Panel         Personal · Max                                  ● 2 min ago  private
                [meter] [meter] [meter]
                ─────────────────────────────────────────────
                facts: reset grants · extra usage
  Panel         Studio · Pro ...
Provider        [CX] Codex ...
...
Connect row     + Connect another account
Legend          fill · tick · 70% · 90% · unknown
```

- **Top line.** Logo lockup, a muted summary (account count, oldest data age), two text links.
  On phones the summary drops to its own line. No toolbar, no search, no filters.
- **Provider section.** Mark, provider name, account count when more than one. Providers sort by
  the most urgent account inside them (highest used share of any window), then by name.
- **Account panel.** One linked account. Header, optional notice, meters, facts, a quiet
  disclosure for details. Panels of one provider sit 12 px apart; providers sit 48 px apart.
- **Connect row.** A dashed panel-shaped link at the end of the list.
- **Legend.** One muted line. Tooltips on the tick and the hatch repeat it in place.
- **Empty state.** No accounts: the logo, one sentence, one primary button "Connect an account",
  and the list of providers as plain text. Nothing else on the page.
- **Loading.** Skeleton panels in the same shape as real panels (header line, three meter blocks,
  one facts line), one per known account, never a spinner.
- **Error.** The list failed: one notice at the top with Retry. Panels keep their last data.

## 3. Account panel anatomy

```
┌─────────────────────────────────────────────────────────────────────┐
│ Label  Plan                         ● state text · age   [private]  │  header
│ ┆ notice (reconnect, paused, failed refresh)                      ┆ │  optional
│ Meter            Meter            Meter                              │  meters grid
│ ─────────────────────────────────────────────────────────────────── │
│ Fact  Fact  Fact                                     [action] [▸]   │  facts
│ ┆ details: capabilities, latest run, observed/received, versions  ┆ │  disclosure
└─────────────────────────────────────────────────────────────────────┘
```

**Header.** Label at 16/500 with the plan in secondary weight 400 when the label carries one.
Right side: status dot and text, then chips. Chips: `private` for private interfaces, the scope
when it is not `individual`, `paused`. Status text:

| Situation | Dot | Text |
| --- | --- | --- |
| ready, fresh | success | `2 min ago` |
| ready, latest run failed non-definitively | success | `2 min ago · retrying` (title shows the sanitized error) |
| stale (list route flag, or age beyond threshold) | warning | `3 h ago, stale` |
| partial | warning | `2 min ago` plus chip `partial`; the missing metric says why in its own cell |
| reconnect_required | danger | `2 days ago`, notice with reason and Reconnect |
| paused | muted | `paused · 1 d ago`, notice with Resume |
| never collected | muted | `waiting for first refresh` with skeleton meters |

**Notice.** One line, tone surface, text left, action right. Reconnect is the only primary button
on the page and appears only here. Resume is secondary.

**Meters.** A grid of fixed thirds (one column on phones). One cell per window bucket. Cell:
label 14/500 with window in muted, display value 30/500 with unit 14 secondary, pill bar 10 px
with elapsed tick, caption 13 secondary with the reset in foreground 500.

**Facts.** Hairline above. Inline key/value items, value 500 foreground, key secondary. Holds
everything that is not a window: balances, spend against caps, reset inventory, unlimited rows,
counts. The action button, when any, sits at the far right. A spend with a cap gets a 6 px thin
bar under the fact row only when the cap is known.

**Details disclosure.** A quiet "Details" text button at the far right of the facts row. Expands
in place: capabilities table (metric or action, availability, evidence, reason), latest run
(time, outcome, sanitized error), snapshot observed and received times, connector version, and
the secondary actions Refresh now, Pause, Disconnect. Nothing in the disclosure is needed to read
the panel.

## 4. Metric kind to shape

| Kind | Shape | Rule |
| --- | --- | --- |
| `quota_percentage` with a window | Meter cell | Value `N%`, bar filled to N, tick at elapsed share when `resetsAt` and the span are known. Tone neutral, warning from 70, danger from 90. Clamp the fill at 100, show the true number |
| `quota_percentage` without a window (`account`) | Meter cell, no tick | Same, caption names the scope |
| `absolute_quota` with `unlimited` | Fact | `Chat unlimited` |
| `absolute_quota` count | Fact | `300 requests`; never "of" unless the provider gave the entitlement |
| `credits` | Fact | `1,240 credits`, remaining; `unlimited` as text |
| `spend` with a `spending_cap` in the same scope | Fact pair plus thin bar | `$3.20 of $20` with a 6 px bar; cap 0 means off |
| `spend` without a cap | Fact | `$3.20 this cycle` |
| `spending_cap` alone (Cursor `included.limit`) | Caption of the included meter | `$20 plan` |
| `reset_inventory` | Fact with pips | Pips equal to count, `3 available`, first expiry in muted when rows carry one |
| availability not `available` | Meter or fact in unknown style | Hatched bar or em dash, caption carries the reason in plain words |
| row absent | nothing | Not drawn, not mentioned |

Window labels follow `research/data-inventory.md` section 11: `5-hour`, `Weekly`, `Monthly`,
`Billing cycle`, `On-demand`, `Last 30 days`. The tick needs a span: scope seconds for
`window:<N>s`, `windowStart/End` for Grok, Cursor and Vercel, calendar month for Copilot. Rows
without a span get no tick.

Reset caption: under one hour `in 42 min`, under a day `in 2h 10m`, under a week `Thu 09:00 ·
3d 4h`, otherwise the date. The absolute instant is always in the tooltip.

## 5. Panel composition per provider

What each provider's panel holds when the account reports everything. Rows the account omits
disappear; the layout never shows a placeholder for them.

| Provider | Meters (in order) | Facts | Notes |
| --- | --- | --- | --- |
| Claude | 5-hour · Weekly, all models · Weekly, Sonnet · Weekly, `<model>` scoped limits | Reset grants (pips) · Extra usage spend of cap when enabled | Scoped limits share the weekly reset: caption `same window` |
| Codex | 5-hour or Weekly from scope seconds · `<name>` limits | Credits balance · Reset credits (pips, first expiry) · action Reset weekly limit now | The only action. Disabled with a hint while actions are off |
| Grok | Weekly pool · `<product>` share of pool | On-demand spend of cap (thin bar) · Prepaid balance | Cap 0 shows `On-demand off` |
| Antigravity | Gemini 5-hour · Gemini weekly · Claude and GPT 5-hour · Claude and GPT weekly | none | Free tier reports weekly only; caption notes it |
| Copilot | AI credits used (percent, monthly, reset date) | Credits used count · Extra usage count · Chat unlimited · Completions unlimited | No entitlement is reported, so never "x of y" |
| Cursor | Included (segments Auto and API, caption `$20 plan`) | On-demand spend of cap (thin bar) | Billing cycle dates in the meter window text |
| Vercel AI Gateway | none | Credit balance · Credits used · Spend last 30 days (unknown without Pro, reason shown) | Permanently partial without Pro; the chip says so |

## 6. Labels and copy

- Sentence case everywhere. No eyebrow labels, no all caps.
- Keys map to labels through one table in the web client (section 11 of the inventory). Unknown
  keys fall back to the key with dots replaced by spaces.
- Units: `credits` are never dollars; `codex_credits`, `grok_credits` and `gateway_credits` all
  print as `credits` but never share a sentence.
- Numbers: tabular figures, at most 2 decimals for percent, 2 for money, thousands separators.
- Ages: `just now`, `N min ago`, `N h ago`, `N days ago`.

## 7. Component inventory

| Component | Owns | Notes |
| --- | --- | --- |
| `TopLine` | logo lockup, summary, links | |
| `ProviderSection` | mark, name, count, stack of panels | |
| `AccountPanel` | header, notice, meters, facts, disclosure | |
| `StatusText` | dot and text from state, age, latest run | |
| `Chip` | label pills | neutral, warn, bad |
| `Meter` | label, value, bar, caption | role meter, aria values |
| `Bar` | track, fill, segments, tick, unknown hatch | tones |
| `Fact` | key, value, unit, pips, thin bar | |
| `Pips` | reset inventory | |
| `Notice` | one-line message with action | bad, warn, neutral |
| `Button` | primary, secondary, quiet | press feedback, disabled with title |
| `Disclosure` | details toggle and body | native `details` with animated height |
| `Skeleton` | loading shapes | |
| `EmptyState` | first run | |
| `Legend` | the five swatches | |

## 8. Finish and motion

Borrowed from `research/arc-ui.md` and fixed here so the implementation does not re-decide them.

**Finish**

- Surfaces: page, panel, muted fill, raised. Dark mode steps them by about 2.5 L in oklch; light
  mode is white on near-white and takes its depth from borders. Panels rest on a 1 px border with
  no shadow. Shadows belong to floating layers only.
- Three border strengths: subtle inside a panel, default at its edge, strong on inputs and hover.
- Text: foreground, secondary, muted. Weights 400 and 500 only. Display numbers 30 px with the
  unit at 14 px secondary on the same baseline. Tabular figures everywhere a number can change.
- Tone recipe for status: background is the tone mixed 10% into the surface, border is the tone
  mixed 25% into the border, icon in the tone, text stays foreground. Colour never stands alone;
  every toned pill or notice carries an icon and words.
- Healthy state is quiet text with a success dot. Pills appear only when something needs
  attention: retrying, stale, partial, reconnect, paused, waiting.
- One accent, neutral. Segments of one bar are steps of that accent (100%, 58%, 34%) so a bar
  reads as one allowance, not a rainbow. Warning and danger replace the accent only on the fill
  that crossed the threshold.
- Radii 12 px for controls and 20 px for panels, pill for chips. Hover fills apply on fine
  pointers only. Focus rings stay visible (Arc removes them; we do not).
- Buttons are 36 px, 14/500. Primary is the inverted foreground, one per page (Reconnect).
  Secondary is bordered. Quiet is text only. Danger is secondary with danger text.
- Risky action: hold to confirm, 1.2 s linear fill that rewinds on release, keyboard hold
  supported, disabled with a title while actions are off.

**Motion**

| Layer | Value | Use |
| --- | --- | --- |
| Instant | 120 ms, standard ease | press-down, tiny fades |
| Fast | 160 ms, standard ease | hover colour, exits |
| Standard | 240 ms, enter ease | text and panel enters, details body |
| Spring | 580 ms, `linear()` spring with 0.6% overshoot | press release |
| First paint | 580 ms, standard ease, 70 ms stagger per cell capped at 250 ms | bars grow from the left, numbers count up once |
| Value change | 400 ms, no overshoot | bar refills, number counts to the new value |

- Bars animate with `transform: scaleX` from the left, never width. The tick fades in after
  the bar has grown.
- Numbers count up on first paint and count to the new value on refresh. The headline number may
  roll digits later; count-up is the default because it is cheap and matches the bar.
- Text that changes (ages, captions, status) swaps in place: new text rises 0.3 em with a 4 px
  blur in 240 ms, old text leaves upward in 160 ms. Widths follow on a spring so pills never snap.
- Details body grows with `grid-template-rows` 0fr to 1fr in 240 ms; the chevron rotates.
- Skeleton pulses 1.8 s per cycle, 90 ms apart, 11 cycles, then rests.
- Nothing flies in on scroll. Panels do not animate on load except their bars and numbers.
- Reduced motion: every transition and animation collapses to instant, press scale is off,
  swaps become 120 ms fades. The mockups honour `prefers-reduced-motion` and accept
  `?motion=off` for screenshots.

## 9. Backend work the view needs

From the inventory:

- An overview route that returns every account with its latest snapshot, metrics, reset credits
  and latest run in one response. Today the list carries only a metric count and the view would
  need one call per account.
- `stale` on the detail response, or the threshold exposed, so a panel can age correctly.
- The list schema must accept a null `latestRun.outcome` (in-flight run).
- Claude `limits[].percent` null must map to unknown, not the string `"null"`.
- Copilot 403 without `Retry-After` is classified `rate_limited`; `permission_denied` is
  unreachable.
- The detail route spreads the stored row and leaks `providerAccountId` and `workspaceId` on the
  wire; build the object explicitly.
- Labels contain an email or login for Codex, Claude, Grok and Antigravity. The panel shows the
  label as stored; a later owner-editable label would let the page avoid identifiers.

## 10. Logo

Four concepts in `mockups/logo.html`. Recommended: concept 4, Ledger: a solid rounded tile with a
thin ceiling line and two bars of different length. It says several accounts under one limit,
reads at 16 px, works inverted, and matches the meters on the page. Lockup: mark 24 px, wordmark
Geist 500 at 16 px, 10 px gap.

## 11. Build plan

1. Mockup D (`mockups/d-panels.html`, `mockups/d-states.html`) from this structure. Done on
   2026-10-02 after three audit rounds at 390, 768 and 1180 px in both schemes. Open items are
   in `README.md`.
2. Port the tokens and primitives to `apps/web/src/styles.css` and the components to React.
3. Add the overview route and the fixes in section 9.
4. Replace the connections and detail pages with the one page; keep connect and account pages.

Audit checklist: no empty regions without a purpose; every number has a unit or a percent sign;
every bar has a label and a value; every state in section 3 appears somewhere in the mockup;
contrast 4.5:1 on all text; no horizontal overflow at 390 px; tab order follows reading order;
reduced motion verified; light and dark both reviewed.
