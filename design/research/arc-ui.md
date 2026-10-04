# Arc UI design survey for a quota dashboard

Research input for the Headroom design. Surveyed 2026-10-02 from https://uiarc.dev.
This file records values, structures and patterns in my own words. Snippets are short and illustrative only.

## 0. Method, evidence and licence

Evidence labels used below:

- `registry`: read directly in the item's TSX and CSS module from the public registry JSON (`https://uiarc.dev/r/<name>.json`). Most reliable.
- `doc`: stated in Arc's own docs, llms.txt, skill files or per-item catalog metadata.
- `derived`: computed by me from registry values (marked where used).
- `unseen`: not fetched or not reproducible (Pro source, rendered visuals).

Sources actually fetched:

| Source | URL | Status |
| --- | --- | --- |
| llms.txt index | https://uiarc.dev/llms.txt | 200 |
| Catalog with per-item motion, a11y and responsive notes | https://uiarc.dev/r/catalog.json | 200 |
| Agent skill files (design, motion, copy, composition, accessibility, responsive, checklist, components, examples) | https://uiarc.dev/r/skills/arc/<file>.md | 200 |
| Docs: motion, theming, installation, introduction, AI | https://uiarc.dev/docs/<page> | 200 |
| Foundation tokens + motion tokens | https://uiarc.dev/r/arc-foundation.json | 200 |
| 40+ free component registries | https://uiarc.dev/r/<name>.json | 200 |
| Free blocks: page-header, notification-center, empty-states, plan-comparison, stats-band | https://uiarc.dev/r/<slug>.json | 200 |
| Pro blocks (usage-billing, billing-overview, metrics-dashboard, kpi-drilldown, wallet-card, settings-page, integrations, api-keys, team-members, usage-pricing, usage-forecast) | https://uiarc.dev/r/pro/<slug>.json | 401, source gated. Only public catalog text read |

Licence finding (changes the brief's premise):

- https://uiarc.dev/license says free items are MIT, "Copyright (c) 2026 Elia Kuratli". Pro items are under a separate proprietary licence that bans redistribution, bans offering Pro source through a public registry or MCP server, and (per llms.txt) tells agents never to reconstruct Pro items.
- The page is marked "Draft, pending review" by the author. The MIT text is still complete and plain.
- Consequence for Headroom: free-item patterns (all of Sections 1 to 3 except 3.39) may be reimplemented, and even adapted from source, if the MIT notice is kept on any copied substantial source. Pro blocks (usage-billing, billing-overview, metrics-dashboard, kpi-drilldown, wallet-card, settings-page, integrations, api-keys, team-members, usage-pricing, usage-forecast) must not be reconstructed. Section 3.39 records only what Arc publishes in public catalog text about them.
- Safest course for Headroom: reimplement from the recorded values and rules here, in Headroom's own stack and naming. No attribution is required for ideas and numbers, and copying code would trigger the MIT notice requirement.

Interpretation notes:

- Arc is React + Motion (the `motion/react` library) + CSS modules + Radix primitives. Headroom's stack may differ. Everything below separates "value" from "mechanism" so values can be ported to plain CSS where possible.
- "Items named in the brief that do not exist": `stat-card`, `action-swap` and `theme-switcher` 404 in the registry. The skill files reference `stat-card` and `action-swap`, but the registry only ships `metric-card`, `stats-band`, `text-morph` and `theme-switch`. This is an inconsistency in Arc's own docs. `metric-card` is the free KPI card.

---

## 1. Foundation (https://uiarc.dev/r/arc-foundation.json)

Evidence: `registry` for every value in this section. Two files: `foundation.css` (custom properties, accents, series palette, one global reset) and `motion-tokens.ts`.

### 1.1 Colour roles, neutral accent

The whole neutral ramp is chroma 0 in OKLCH. Surfaces are pure grey, not tinted.

| Token | Light | Dark |
| --- | --- | --- |
| `--background` | oklch(100% 0 0) | oklch(19% 0 0) |
| `--surface` | oklch(100% 0 0) | oklch(21.5% 0 0) |
| `--surface-raised` | oklch(100% 0 0) | oklch(24% 0 0) |
| `--surface-muted` | oklch(97.8% 0 0) | oklch(26% 0 0) |
| `--foreground` | oklch(15% 0 0) | oklch(96% 0 0) |
| `--text-secondary` | oklch(46% 0 0) | oklch(77% 0 0) |
| `--text-muted` | oklch(59% 0 0) | oklch(64% 0 0) |
| `--border` | oklch(93.5% 0 0) | oklch(29% 0 0) |
| `--border-subtle` | oklch(96.5% 0 0) | oklch(25% 0 0) |
| `--border-strong` | oklch(82% 0 0) | oklch(40% 0 0) |
| `--accent` (neutral) | oklch(33% 0 0) | oklch(80% 0 0) |
| `--accent-strong` | oklch(24% 0 0) | oklch(91% 0 0) |
| `--accent-subtle` | oklch(33% 0 0 / .10) | oklch(80% 0 0 / .13) |
| `--accent-foreground` | = `--background` | = `--background` (unset in dark block) |
| `--success` | oklch(49% .19 150) | oklch(78% .18 150) |
| `--warning` | oklch(58% .18 75) | oklch(83% .17 80) |
| `--danger` | oklch(54% .21 25) | oklch(76% .2 25) |

Notes:

- Light mode has the page, card and raised surface all at 100% white. Depth in light mode comes from borders and shadow only. Dark mode steps surfaces by about 2.5 lightness points (19, 21.5, 24, 26).
- Neutral ramp `--neutral-0` to `-11`: 100, 99, 97.8, 95.8, 91.5, 84, 72, 59, 46, 34, 23, 15 (% lightness). Components must not use the ramp directly, only the semantic roles.
- Status colours are darker and saturated in light (L 49 to 58) and light and bright in dark (L 76 to 83). Hue 150, 75/80, 25.

### 1.2 Accent set (`data-accent` on `<html>`)

Eight accents. Values are sRGB hex in light, a lighter step in dark, and the subtle fill is the accent at 12 to 16% alpha (20 to 22% in dark).

| Accent | Light accent / strong | Dark accent / strong | Subtle alpha (light / dark) |
| --- | --- | --- | --- |
| neutral | oklch 33% / 24% | oklch 80% / 91% | .10 / .13 |
| violet | #7747ff / #5528ce | #a78bff / #c7b7ff | .13 / .22 |
| blue | #0562ef / #074db7 | #6ba3ff / #a4c7ff | .12 / .22 |
| green | #0db879 / #087c54 | #53dca6 / #93efd0 | .13 / .20 |
| amber | #f3ad20 / #9c6300 | #ffcb62 / #ffe0a1 | .16 / .20 |
| orange | #f48120 / #aa4700 | #ffad5e / #ffd0a0 | .13 / .20 |
| coral | #f15f55 / #b92c27 | #ff9386 / #ffc1ba | .14 / .20 |
| rose | #ed4e9d / #ae2570 | #ff8bc5 / #ffc0df | .14 / .20 |

Light and bright accents (green, amber, orange, coral, rose) also set a dark `--accent-foreground` (for example #102016, #20190d) so text on a filled accent stays readable.

### 1.3 Selection-control tokens

A separate token family so switches, checkboxes and sliders keep contrast on every accent:

- `--control-on` (filled state), `--control-glyph` (check/dot on it), `--control-track` / `--control-track-hover` (off), `--control-thumb` / `--control-thumb-on`, `--control-thumb-shadow`, `--control-on-subtle` (10% mix), `--control-fill` (slider).
- Neutral light: on = near black (23%), thumb white. Neutral dark inverts: on = near white (93%), thumb dark (19%), so on and off never look alike.
- Track off: 89.5% light (86% hover), 33% dark (37% hover).
- Thumb shadow is three layers: a 0.5px ring at 7% black, a 1px 2px blur at 14%, a 2px 6px blur at 6%.

### 1.4 Chart series palette

- `--series-1..4`. Series 1 is derived from the accent. Series 2 to 4 rotate hue by +57, +184 and +292 degrees (light) or +66, +175, +270 (dark), with lightness offsets of -.25, +.14, 0 (light) and -.19, +.02, -.10 (dark), using CSS relative colour syntax. Neutral accent falls back to a blue base (hue 250).
- Static fallback (no relative colour): light #1f7dcf, #7128a5, #e58f00, #009e84; dark #55adff, #9c37be, #e66e00, #00a861.
- Arc claims the set was checked with a dataviz script across all accents and both themes for colour-vision difference (every pair clears CVD delta-E 9 and normal-vision delta-E 17). `doc`.
- Beyond four series the donut falls to neutral steps: foreground mixed into surface at 56%, 42%, 32%; "Other" is 26%. `registry` (donut-chart).

### 1.5 Geometry

| Token | Value | px |
| --- | --- | --- |
| `--space-1,2,3,4,5,6,8,10,12,16,20,24` | .25, .5, .75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6 rem | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 |
| `--radius-control` | 1.125rem | 18 (inputs, buttons, alerts, segmented frame) |
| `--radius-panel` | 1.625rem | 26 (menus, popovers, toasts, small cards) |
| `--radius-surface` | 2.125rem | 34 (cards, dialogs) |
| `--radius-pill` | 9999px | badges, chips, avatars, small round buttons |
| `--control-height-sm / md / lg` | 2.25 / 2.75 / 3.125 rem | 36 / 44 / 50 |

The radii are generous (18/26/34). Doc rule: nested radius = outer radius minus padding (so an 8px-padded 34px card holds a 26px inner, which equals `--radius-panel`). Several blocks (page-header frame 16px, empty-states card 20px, notification panel 23px, tabs in empty-states 12px) deviate and use their own pixel radii. Arc is not perfectly consistent here.

### 1.5a Shadows

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-resting` | 0 1px 2px black 3.5% | 0 1px 2px black 18% |
| `--shadow-raised` | 0 6px 18px 6.5% + 0 1px 3px 3.5% | 0 8px 22px 22% |
| `--shadow-floating` | 0 20px 48px 10.5% + 0 3px 10px 4.5% | 0 22px 55px 34% |

Rule (design.md): cards rest on a 1px border with no shadow. Shadows go on floating layers only (menus, popovers, dialogs, toasts, tooltips). `resting` appears on a few small raised pieces (selected segment, KPI card, alert, badge hover).

### 1.6 Typography

| Item | Value |
| --- | --- |
| Display face | Geist Variable, for headings 30px and up and for big numbers |
| Body face | Inter Variable, for everything else |
| Weights | 400 and 500 only. Never 600 or bold |
| Scale | xs 12, sm 14, base 16, lg 18, xl 22, 2xl 28, 3xl 36, 4xl 52, 5xl 72 px |
| Display tracking / leading | -0.03em / 1.1 |
| Body tracking / leading | -0.01em / 1.4 |
| Numbers that change | `font-variant-numeric: tabular-nums` always |

Practical type sizes observed in components:

- Control and row text: 14px / weight 500 (buttons, tabs, chips, segmented, menu items).
- Captions and metadata: 12px (xs), colour `--text-muted` or `--text-secondary`.
- KPI and gauge numbers: Geist 36px (3xl) weight 500, line-height 1 (counter) or 1.1.
- Donut centre value: Geist 28px. Sparkline headline: Inter 18px weight 500.
- Dense blocks (notification-center, page-header) use fixed 11 to 13px sizes outside the scale, and a 20px title with -0.025em tracking.

### 1.7 Easing, durations, springs

CSS custom properties:

| Token | Value | Use |
| --- | --- | --- |
| `--ease-enter` | cubic-bezier(.16, 1, .3, 1) | arrivals, strong ease-out |
| `--ease-standard` | cubic-bezier(.22, 1, .36, 1) | colour, opacity, default |
| `--ease-exit` | cubic-bezier(.7, 0, .84, 0) | declared for exits, unused by any item CSS I read; exits in practice use `--ease-standard` |
| `--ease-in-out` | cubic-bezier(.65, 0, .35, 1) | on-screen moves, line draw, skeleton |
| `--ease-spring` | linear() of 37 stops, peak 1.0062 near stop 25, ends 1 | transforms with a soft settle (about 0.6% overshoot) |
| `--duration-instant` | 120ms | press-down, tiny fades |
| `--duration-fast` | 160ms | hover, colour, small state |
| `--duration-standard` | 240ms | panels, menus, enters |
| `--duration-considered` | 480ms | rare intro reveals |
| `--duration-spring` | 580ms | pairs with `--ease-spring` |

Spring curve shape (abbreviated, first and peak stops only):

```css
--ease-spring: linear(0, 0.0258, 0.09, 0.1763, ... 1.0047, 1.0058, 1.0062, 1.0062, ... 1.0013, 1);
```

JS motion tokens (`motion-tokens.ts`, seconds):

| Group | Token | Value |
| --- | --- | --- |
| duration | instant / fast / exit / standard / considered | 0.12 / 0.16 / 0.18 / 0.24 / 0.48 |
| ease (bezier arrays) | enter / exit / standard / inOut | same four curves as CSS |
| spring | snappy | visualDuration 0.26, bounce 0.12 |
| spring | smooth | visualDuration 0.40, bounce 0 |
| spring | morph | visualDuration 0.42, bounce 0.16 |
| spring | responsive | stiffness 520, damping 38 (pointer tracking) |
| spring | gentle | stiffness 340, damping 34 (large calm layout) |
| stagger | char / word / line / item | 0.016 / 0.04 / 0.08 / 0.035 |
| blur | subtle / soft / text | 2 / 4 / 8 px |

`derived` (formula copied from usage-meter's helper: root = 2 pi / (visualDuration * 1.2), stiffness = root squared, damping = 2 * (1 - bounce) * root):

| Preset | Stiffness | Damping |
| --- | --- | --- |
| smooth | about 171 | about 26.2 |
| snappy | about 406 | about 35.4 |
| morph | about 156 | about 21.0 |

Important detail: Arc rewrites time-defined springs into stiffness and damping in components that retarget mid-flight (usage-meter, donut, confirm-morph), because Motion drops inherited velocity from time-defined springs. A port must keep velocity when a value changes during an animation.

### 1.7a Global reset

One rule removes focus outlines for every focus state and input method, with `!important`. `--focus-ring` is set to transparent. This is a stated product decision, repeated in the skill files. Keyboard position is shown with hover-style fills only. See Section 5 for why Headroom should not copy this without a replacement.

Also in the foundation: a brand gradient (lavender to peach) restricted to marketing backdrops. Not relevant to product UI.

---

## 2. Shared motion primitives (found in nearly every item)

Evidence: `registry` (the same pattern is re-implemented in each component).

### 2.1 "Swap" text transition

A local helper named `Swap` (or an equivalent inline variant) appears in badge, progress, metric-card, gauge, sparkline (as `Roll`), usage-meter, empty-state, alert, toast, dialog, tooltip, dropdown trigger label and more. It is not a shared export. Each file re-declares it.

Mechanism:

1. Wrap changing text in an `AnimatePresence` with `mode="popLayout"` (the leaving copy is taken out of flow so the wrapper never holds both widths) and `initial={false}` (no entrance on mount).
2. Key the child by the text, so a change is an exit plus an enter.
3. Enter: from opacity 0, y +0.3em, blur 4px; to rest. Duration 240ms, `ease.enter`.
4. Exit: to opacity 0, y -0.3em, blur 2px. Duration 160ms (some use 140 to 150ms), `ease.standard`.
5. Direction-aware variant (metric-card, gauge, sparkline, usage-meter, bar-chart): a number that increased enters from below and leaves upward. A decrease flips both. Direction comes from comparing the first number in the old and new strings.
6. The leaving copy gets `aria-hidden` while it fades (a `useIsPresent` check). Only the current text is read.
7. If the wrapper's width must follow, a hidden "sizer" copy of the new text is measured with a `ResizeObserver` and the wrapper width springs (`spring.morph`) to it. Font-load and parent-resize changes jump with no animation.
8. Reduced motion: opacity-only fade, 120ms in, no y, no blur.

### 2.2 Icon swap

Icon crossfade uses scale .6 and blur 2px as the hidden state, scale on `spring.snappy`, and opacity/blur on a 160ms tween (so blur never overshoots below zero). Exit: 160ms, same hidden state.

### 2.3 Width-following pills

Badge, button label slot, chips, status badge in usage-meter, dropdown trigger label: width stays `auto` at rest. After a label change, the old width is pinned, then springs (`morph`) to the new natural width within a 120 to 700ms arming window. Passive reflows follow instantly. This is why Arc chrome never "snaps" when text changes.

### 2.4 Height-following regions

Skeleton/empty-state/alert/toast/chips use a wrapper that springs its height (`smooth`) from the old size to the new one after a content key changes, then returns to `auto`. It clips only while moving.

### 2.5 Counter / digit wheel (rolling digits)

animated-counter, usage-meter's Ticker, number-field, bar-chart, announcement-bar timers all use a digit wheel:

- The formatted number is split with `Intl.NumberFormat.formatToParts` into columns keyed by place value (`i2`, `i1`, `i0`, `f0`, group separators). So 999 to 1,000 keeps the ones column as the ones column and a new column grows in (width 0 to auto on `spring.morph`).
- Each column renders all ten digits stacked at y offsets and drives them from one motion value (the "wheel position"). Each digit's offset from the position decides y (in em), opacity (1 minus distance, so only the active digit is visible), and a blur proportional to distance (up to 2px).
- The wheel turns in the direction the whole number moved, and wraps 9 to 0 like an odometer.
- Wheel spring: `smooth` (no overshoot). First reveal on view: `smooth` stretched to 480ms visualDuration (usage-meter: 580ms), with a per-column stagger of 35ms capped at 250ms.
- Column window is a clipped box with a vertical feather mask (about .16em padding, gradient fading both edges), so a turning digit fades rather than gets cut.
- Accessibility: a visually hidden string carries the final text, the wheels are `aria-hidden`.
- Alternative technique, count-up of a single motion value written to the DOM (donut centre, gauge, progress label): the number text follows the same spring as the graphic so the label always matches the bar. Whole-number targets count in whole steps.

### 2.6 Press feedback

| Control | Press | Release |
| --- | --- | --- |
| Button | scale .97 (.96 at <=48px wide icon buttons, .985 above 220px wide), 120ms `ease.standard` via `whileTap` | `spring.snappy` |
| Button as popup anchor (aria-haspopup, data-state, combobox) | no scale. Background/opacity change only (primary opacity .84, secondary muted fill) | n/a |
| CSS-only controls (copy, close, dismiss, switch in CSS) | scale .96 to .97, transition shortened to 120ms standard on `:active` | `--duration-spring` with `--ease-spring` on release |
| Chip | body scales to .97 via the individual `scale` property, 120ms down, spring up | |
| Confirm-morph surface | scale .96 while pressed, 90ms down | spring |
| Confirm-morph inner buttons | scale .95 | |
| Stepper marker | scale .92 | |
| Legend row (donut) | scale .985 | |

Rule: a press scales everything except a control that anchors a popup, because Radix measures the trigger on pointerdown. Anchors answer with colour.

Hover: all hover styles are wrapped in `@media (hover: hover) and (pointer: fine)`. Touch never gets a sticky hover.

---

## 3. Item catalogue

Format per item: URL, purpose, structure, sizes, colour roles, states, motion, reduced motion. "RM" means reduced motion.

### 3.1 Button (https://uiarc.dev/components/button, https://uiarc.dev/r/button.json)

- Purpose: one action. Variants primary, secondary, ghost, danger. Sizes sm 36, md 44, lg 50 min-height.
- DOM: `<button>` (motion.button) containing an optional loader span, then a label slot, a content span, and a keyed label phase. `aria-busy` while loading. Loading uses `aria-disabled` and swallows clicks, so keyboard focus stays on the button.
- Style: 1px border, radius 18px, padding 0 16px (sm 12px, lg 20px), gap 8px, font 14px weight 500, line-height 1.4.
- Colour roles: primary = foreground fill with background text (inverted, no accent). Secondary = surface fill, border, foreground text. Ghost = transparent, secondary text. Danger = surface fill, danger text, border turns danger on hover.
- States: hover (fine pointer only): primary opacity .91 + resting shadow; secondary muted fill + resting shadow; ghost foreground text + muted fill; danger border danger. Active: primary opacity .84, others muted fill. Disabled: opacity .52, not-allowed. Loading: label hidden, 16px spinner (1.5px border, 0.7s linear spin).
- Motion: whileTap press (Section 2.6). Label change: Swap with y +4px/-3px and blur 4px, 240ms enter / 160ms exit. Icon-only label change uses scale .6 + blur 2px on `snappy`. Width of the label slot springs on `morph`. Loader enters at scale .6 on `snappy`.
- RM: no press scale, opacity-only swaps (120ms), spinner animation effectively off (0.01ms duration, 1 iteration).

### 3.2 Action button (https://uiarc.dev/components/action-button)

- Purpose: async toolbar action with idle, pending, success states (default labels "Saved", "Saving", reset after 2400ms).
- DOM: `<button>`, `aria-busy` while pending, a visually hidden real label plus a `role="status"` live span for the state text.
- Motion: label morphs glyph by glyph. Shared leading and trailing characters keep identity and glide (`layout="position"` on `morph`), changed run rises in with blur, per-glyph stagger 16ms capped at 100ms. A 17px icon slot swaps: arrow leaves to the right (x +8) and returns from the left (x -6); spinner and a self-drawing check (path length 0 to 1 over 240ms, 50ms delay) use the icon crossfade.
- Style: filled foreground, 1px foreground border, radius 18px, padding 0 20px, 44px high, 14px/500. Disabled opacity .7 (not when pending).
- RM: instant fades, spinner static.

### 3.3 Badge (https://uiarc.dev/components/badge)

- Purpose: status label. Tones neutral, success, info, warning, danger. Sizes md (min-height 26px, padding 0 10px, 12px) and sm (22px, 0 8px, 11px). Weight 500, letter-spacing -0.01em, line-height 1, 1px border, pill.
- Tone recipe (important, reusable). Each tone sets 4 variables from one colour `C` and the surface:

```css
--badge-background: color-mix(in oklch, C 10%, var(--surface));
--badge-border: color-mix(in oklch, C 25%, var(--border));
--badge-foreground: C;  /* success, warning, danger */
```

  - Percentages: success 10% bg / 25% border; warning 11% / 27%; danger 10% / 26%. Info uses accent-subtle for bg, `--accent-strong` for text, 24% border mix. Neutral = muted surface, secondary text, plain border. Icon colour = tone colour.
  - Hover (fine pointer): border mixes 32% of the tone colour into border, bg mixes 10% of tone into surface, even for neutral (uses foreground).
- Icon: optional leading, gap 5px (sm 4px).
- Motion: text Swap (y 0.3em, blur 4px), icon swap on `snappy`, pill width springs to new content on `morph` (pinned old width if change happened less than 120ms ago).
- RM: width follows instantly, fade-only, colour transitions drop to 120ms.

### 3.4 Chip group (https://uiarc.dev/components/chip-group)

- Purpose: filter facets with multi-select and an overflow "+N" chip.
- DOM: `role="group"` with `aria-label`, each chip a `<button aria-pressed>`, overflow chip `aria-expanded`. One tab stop with roving arrows.
- Size: chip height 36px, padding 0 14px, pill, 14px/500, label colour secondary (foreground when selected or hovered), 8px gap.
- Selected: border = accent 42% mixed into border, fill = accent 11% mixed into surface, plus a check. Hover on selected: 60% border, 16% fill. Colour is never the only signal because the check also appears.
- Motion: the visible "surface" trails the layout box on a spring so the pill edge follows (`lag` motion value springs to 0 on `morph`). A 14px check grows from the left edge and the label slides over (an 18px slot opens). Container height springs on `smooth`. Revealed chips enter scale .9 to 1 with a stagger of 35ms per item capped at 300ms. Leaving chips exit faster (120ms).
- RM: layout and spring off, 150ms fades.

### 3.5 Tooltip (https://uiarc.dev/components/tooltip)

- Radix tooltip. Delay 250ms. Skip window 300ms across all tooltips (a module-level "warm" state), so the next one opens with no delay and no travel (90ms fade only).
- Look: inverted. Background = foreground, text = background, 1px border at 14% mix, radius 18px, padding 12px 16px, 14px/400, max width 15rem, raised shadow, offset 8px, collision padding 12px.
- Enter via `@starting-style` transitions: from opacity 0, translateY 3px (-3px at bottom), scale .97, 160ms enter ease. Exit 110ms standard, scale .98. Using transitions rather than keyframes lets a re-hover reverse mid-fade.
- Text change while open: Swap and the bubble springs to the new size (`morph`).
- RM: opacity 90ms linear, no transform.

### 3.6 Hover card (https://uiarc.dev/components/hover-card)

- Popover-based preview, role tooltip, read-only content. Open delay 500ms, close delay 140ms. Within 300ms of another card, opens after 80ms with fade only.
- Look: 18.5rem wide, padding 16px, radius 26px, raised surface, floating shadow. Profile: 48px avatar, name 16px/500, role 14px secondary, stats row separated by a `--border-subtle` hairline (numbers 16px/500 tabular above, labels 12px muted below, via `column-reverse`).
- Motion: grows from the trigger edge, scale from .96 with a 4px offset on `smooth`, separate fade (160ms in, 120ms out; the out move is a 120ms standard tween). Rows settle with y 4px, 240ms enter, delay 40ms plus 35ms per row.
- RM: fade only.

### 3.7 Popover (https://uiarc.dev/components/popover)

- Radix popover. Radius 26px, padding 16px, min width 12rem, max 22rem, raised surface, floating shadow, side offset 6px, collision padding 10px.
- Enter: opacity 160ms enter ease, transform on the 580ms spring curve, from 5px toward the trigger and scale .97 (via `@starting-style`). Exit: 140ms standard, half the travel, scale .98, `pointer-events: none`. A no-op keyframe times the unmount.
- Anchor press: color only, never scale.
- RM: opacity 120ms linear, no transform.

### 3.8 Progress (https://uiarc.dev/components/progress)

- `role="progressbar"` with `aria-label`, min, max, now, and `aria-valuetext` "NN%".
- DOM: optional meta row (label left, value right, margin-bottom 8px, gap 14px), then the track.
- Track: 7px high, 1px border, pill, background muted. Fill: accent, becomes success on complete (200ms delay).
- Value text: muted, tabular, with a hidden "100%" row reserving the widest width so a check never shifts.
- Motion: one `smooth` spring drives both the fill and the counted label. The fill slides in from the left as a translate (x from -100% to 0), not a scaleX, so the rounded end never distorts. On completion a 14px check settles in beside the number (snappy, 240ms delay).
- RM: jumps to value, no transitions on the fill.

### 3.9 Gauge (https://uiarc.dev/components/gauge)

- Purpose: single value against a range, with threshold bands that change tone and wording.
- DOM: `<figure>` with `aria-label` ("label: value of max, band"), inner `role="meter"` with valuemin/max/now/valuetext, SVG ring `aria-hidden`, a readout, `<figcaption>` with a 14px/500 label and a 12px muted tabular detail.
- Ring: viewBox 100 by 90, radius 42, a 270 degree arc open at the bottom starting at -135 degrees, stroke width 9 with round caps, track = tone at 13% alpha. Max width 176px. Centre number Geist 36px/500 with a `%` at .5em in secondary.
- Tone: `accent | success | warning | danger`, plus a `thresholds` array where the highest reached band sets tone and status text, so state is never colour alone (status line 12px/500 in tone colour).
- Motion: first fill when 50% in view, slower (480ms x 1.6 = 768ms visualDuration, no overshoot). Later changes: arc on `morph` (small life), number on `smooth`. The state label and colour change exactly when the counted number crosses a threshold (listens to the count value). Digits box is right aligned in a box sized to the target number, so the ones column never jumps. Arc cap fades in over the first 2% of sweep.
- RM: jumps to value; state appears a frame later after hydration.

### 3.10 Usage meter (https://uiarc.dev/components/usage-meter, https://uiarc.dev/r/usage-meter.json)

The most relevant item. Full record:

- Purpose: fixed allowance with up to four categories, remaining space, near-limit and over-limit states.
- Props: `label`, `segments[{id,label,value}]` (stable ids), `limit`, `unit`, `decimals` (1), `freeLabel` ("Free"), `overLabel` ("Over limit"), `warnAt` (0.9).
- DOM, in order:
  1. Root `role="group"` labelled by the title, `data-status` ok/near/over.
  2. Top row: title (16px/500, `text-wrap: balance`) left, status badge right. Min-height 28px, gap 12px.
  3. Total line: baseline row with the headline number (Geist 36px/500, rolling) and a caption (14px secondary, one line, ellipsis), for example "GB of 50 GB used".
  4. Bar: 14px high track with padding 5px above and below for the limit marker. Track is a pill filled with foreground at 7% mixed into surface. `role="img"` with a full text summary of every segment and the status.
  5. Legend: auto-fit grid, min column 108px, 2px gap, negative side margin so hover fills align to the card edge. Each item is a button: swatch + label (14px secondary) over value (16px/500) + unit (14px secondary).
  6. Hidden polite live region.
- Segment colours: steps of the one accent, strongest first: accent, then accent mixed into surface at 62%, 36%, 22%. Free space is the bare track, with a 10px legend swatch at 7% foreground plus an inset 1px strong border. The meter reads as one allowance, not a rainbow.
- Segments are 2px short of the next so neighbours read apart with no outline (GAP = 2). Legend swatch: 10px, radius 3px.
- Status badge: height 28px, pill, 12px/500, padding 0 10px. ok: muted bg, secondary text, text "N unit free". near (at 90% by default): warning 14% mixed into surface bg, foreground text, warning-coloured 14px alert-circle icon, text "Almost full". over: danger 12% bg, foreground text, danger triangle icon, text "N unit over". The badge text stays neutral, only the icon and the tint carry colour. Width springs to each message and grows from the right edge.
- Over-limit: the bar spans max(limit, used). The overflow region keeps its category colours and is struck with a 45 degree hatch (6px period, 2.5px stripe in the surface colour). A 2px foreground marker shows where the limit sits. Hatch and marker fade on a 160ms tween when usage crosses the limit, so a changing limit never blinks them. Highlighting the overage floods it with the danger colour.
- Interaction: mouse hover on the bar highlights the category under the pointer (others fall to .28 opacity). Legend hover/focus previews the same way (others at .45). Click, Enter or Space pins; Escape clears. Touch: tap pins. The headline number and caption switch to the highlighted category: "GB in Media, 28% of plan".
- Keyboard: roving tab stop in the legend, arrows move, Home/End jump.
- Motion:
  - Segments grow once, left to right, when 40% in view: spring equivalent to 580ms visualDuration (480 + 100) with no bounce, stagger 70ms per segment.
  - Later value changes: each segment re-flows on `smooth`. Each segment's x offset is computed from the sum of the amounts before it in the same frame, so growth in one pushes the rest along with no lag. Segments animate as translate + scaleX with origin left (never width).
  - Limit change animates on `smooth` too, so the bar rescales continuously.
  - Digits roll (Section 2.5) in the headline and in each legend value.
  - Caption, legend labels use Swap.
  - Status icon enters with the scale-pop (scale .6, blur 3px, `snappy`).
  - Animations start one frame after render, so the render that triggered them never swallows the first frames.
- Announcements: only status changes (near, over, growing overage) are announced. Routine value changes stay quiet.
- RM: segment values and limits jump, text swaps with 100 to 150ms fades, transitions removed. Reduced-motion flag is read only after hydration so SSR matches.

### 3.11 Metric card (https://uiarc.dev/components/metric-card)

- Purpose: KPI with label, change pill, big number, one sentence of context.
- DOM: `<article>`; top row (label left, change pill right); animated counter; context paragraph.
- Style: border 1px, radius 34px, padding 24px (16px under 380px), resting shadow, surface fill. Label 14px secondary. Context 14px muted, margin-top 16px. Gap between top row and number 32px.
- Change pill: 1px border, pill, padding 3px 8px, 14px, tabular. When the text starts with + or a minus, the pill gets a trend: bg = success or danger at 11% mixed into transparent, text in that colour, border transparent. The sign carries meaning too.
- Motion: counter rolls in on view; label, change and context use direction-aware Swap; the change pill's width springs (`morph`); pill appears with scale .96 on `snappy`.

### 3.12 Animated counter (https://uiarc.dev/components/animated-counter)

- Props: value, label, prefix, suffix, decimals, `animateOnView`, `locale` (fixed "en-US" so server and client match).
- Style: Geist 36px/500, line-height 1, tabular, tracking -0.03em, optional 12px muted label above (8px gap). Symbols (commas, decimal point, prefix/suffix) are plain inline spans that slide width 0 to auto.
- Motion: see Section 2.5. In-view trigger uses `useInView` once, 60% visible. Direction state persists so decreases roll downward.
- Accessibility: hidden text carries the full string.

### 3.13 Sparkline (https://uiarc.dev/components/sparkline)

- Purpose: trend beside a headline value, scrubbable.
- DOM: `<figure>` with figcaption (label left, headline value right 18px/500 tabular, change 12px/500 coloured by tone), then a plot with `role="slider"` and `aria-valuetext` "date: value" when interactive.
- Chart: default 160 by 52, line 2.5px round caps, monotone cubic smoothing (no overshoot past data), baseline 1px `--border`, optional area at 9% of the line colour (currentColor), end dot is a zero-length round-cap stroke 7px (10px while scrubbing). Cursor line 1px `--border-strong`. The section after the cursor dims (stroke `--border-strong`).
- Motion: first draw when 50% in view: path length 0 to 1 over 840ms (480 x 1.75) with `ease.inOut`, area wipe follows the pen, end dot lands last (opacity 160ms plus stroke width on `snappy`). New data morphs the shape from the current one with `smooth` on shared x samples. Cursor springs on `snappy`. Scrub text rolls.
- Keyboard: arrows, PageUp/PageDown (about one sixth of points), Home/End, Escape.
- Touch: `touch-action: pan-y` so vertical scroll still works.

### 3.14 Donut chart (https://uiarc.dev/components/donut-chart)

- Purpose: share of a whole, up to about 5 parts, with a synced legend.
- Defaults: 208px diameter, 24px ring, gap between segments 3px, corner radius 4px, hover lift 4px, group below 4% into "Other", max 6 segments, `legendAction` "toggle" or "select".
- Layout: container query: legend below the ring under 460px width, beside it (auto + 1fr, gap 32px) above. Legend rows: min-height 40px, grid 10px dot / label / value / share (3.25em), padding 6px 10px, radius 12px, 14px. Share is 14px/500 foreground, value secondary, both tabular.
- Centre readout: label 12px secondary, value Geist 28px/500, meta 12px muted tabular. At rest shows total; on hover shows the active segment. Old and new readouts share one grid cell and roll like a drum (y .45em, 260ms enter / 160ms exit).
- Segment shapes are computed with parallel-sided gaps (same pixel gap from inner to outer edge) and rounded corners; a thin segment narrows to a wedge, never pops.
- Colour: `--series-1..4`, then neutral foreground mixes. A key keeps its colour across datasets. Dim = opacity .45. Hidden segment: legend dot empties to a ring, text goes muted, the ring redistributes.
- Motion: first sweep on view (visualDuration .72, no bounce), later changes .5 no bounce, hover lift snappy. Closing segments stay drawn while they close. Centre numbers count on a .4s no-bounce spring written straight to the DOM.
- A11y: polite announcements on show/hide ("Media hidden. Total 42 GB.").

### 3.15 Skeleton (https://uiarc.dev/components/skeleton)

- Structure: optional round avatar block (44px) plus 1 to N lines. Line 12px high, first 16px high at 48% width, last 72% wide; gap 12px, radius 18px; fill = border-strong at 38% mixed into surface.
- Animation: opacity 1 to .52 and back over 1.8s with `ease.inOut`, each line delayed an extra 90ms in sequence, 11 iterations only (about 20 seconds), then rest. Finite by design, so a stalled load stops pulsing.
- `role="status"`, `aria-label`, `aria-busy="true"` on the placeholder.
- Swap to content: placeholder exits in 160ms; content enters opacity 0 to 1 and y 4px to 0 over 240ms; the frame height springs from placeholder to content height on `smooth`.
- RM: no pulse, 120ms fades.
- Rule (composition.md): the skeleton must use the final layout's dimensions.

### 3.16 Empty state (https://uiarc.dev/components/empty-state)

- Structure: a 48px icon tile (radius 26px, 1px border, muted fill, secondary icon) above `h3` (16px/500, margin-top 20px) and a description (14px secondary, max width 18rem, `text-wrap: balance`, margin-top 8px), then up to two actions (gap 12px, margin-top 20px). Padding clamp(32px, 8vw, 48px) vertical, 20px horizontal.
- Motion: the icon tile settles once on first appearance (scale .92 to 1, opacity 0 to 1, 480ms `ease.enter`). Later changes swap title, description and icon in place (Swap + height spring `smooth`).
- This is the one place Arc uses an icon in a rounded tile. The design rules otherwise forbid icon tiles.
- Copy examples from the block (https://uiarc.dev/r/empty-states.json): "No results for \"Q3 roadmap\"", "Two filters are on: owner is Emma Collins and status is archived." with action "Clear filters"; "You are offline" / "Edits are saved on this device and sync when the connection returns." with action "Try again". After the action, copy changes to a result state ("Back online", "Three edits synced..."). Each scene has a loading line in progressive form ("Reaching sync.northwind.example...").

### 3.17 Card (https://uiarc.dev/components/card)

- Border 1px, radius 26px, surface, no resting shadow. Content padding 20px. Title 18px/500 line-height 1.3 `text-wrap: balance`, description 14px secondary max-width 34ch margin-top 8px, footer margin-top 20px with a 32px avatar and a 12px byline (name 500 foreground, status muted tabular).
- Hover (fine pointers): lift y -2px on `snappy`, border becomes `--border-strong`, shadow raised (shadow transition 240ms). Media zooms to 1.04 over 960ms in, 480ms back.
- Optional "quick look" (details): card grows into a dialog on one shared-layout spring (smooth, 300ms visualDuration), crossfade off so one opaque surface moves; overlay oklch(10% 0 0 / .46) + 7px backdrop blur; close button 32px circle with glass fill; details block separated by 1px border, margin-top 24px. Closing flies back to the card's exact box, then hands over.
- Status line change: words stagger 40ms each.
- Not directly needed for a dashboard, but the "hand-over without a seam" technique is the model for expandable KPI cards.

### 3.18 Expandable card (https://uiarc.dev/components/expandable-card)

- Header button min-height 64px, padding 16px 20px, title 14px/500 over description 12px muted tabular (margin-top 4px). Radius 34px, border 1px, resting shadow.
- Panel: muted background, 14px secondary text, divider drawn as an inset 1px shadow rather than a border so a collapsed panel is exactly zero height. Panel padding 16px 20px 20px.
- Hover/pressed header fill = muted. Arrow turns foreground when open. Height and (once measured) width animate on springs. RM: transitions off.

### 3.19 Segmented control (https://uiarc.dev/components/segmented-control)

- `role="group"` with `aria-label`, buttons `aria-pressed`, roving tabindex.
- Frame: inline-flex, 1px border, muted fill, radius 18px, padding 3px, gap 2px. Buttons: min-height 36px, padding 0 13px, radius 15px (18 minus 3), 14px/500, muted text, foreground when hovered/pressed.
- Selected highlight: one shared `layoutId` pill (surface fill, 1px border, resting shadow) that glides on `spring.morph` under all labels. Labels never scale or change weight; only colour changes.
- Overflow: track scrolls with a 20px mask fade at either edge.
- RM: highlight jumps.

### 3.20 Tabs (https://uiarc.dev/components/tabs)

- Same shell and highlight as the segmented control, but active label uses `--accent-strong`, min trigger width 5.5rem, padding 0 12px. 35px mask fades and 33px scroll buttons appear on overflow.
- Panel change: the new panel enters 8px from the side of travel (opacity 240ms enter ease, x on `smooth`); the old one leaves 6px the other way in 120ms. The panel height springs (`smooth`) between panels. Direction follows tab order.
- Compare with page-header's tab bar (a line-style tab used in a block): 44px high tabs, 2px accent underline indicator that glides, hover fill 4.5% foreground, count in muted tabular next to the label, hairline under the strip.

### 3.21 Switch (https://uiarc.dev/components/switch)

- Radix switch, track 42 by 24px, padding 3px, thumb 18px. Off track = `--control-track`, on = `--control-on` crossfaded via a pseudo-element (opacity 240ms).
- Motion: thumb travels on a 300ms no-bounce spring (it reports state, so no overshoot). While pressed the thumb stretches (scaleX to 1.16 and back over 340ms, far edge anchored) and its width grows via `snappy`. Hit target min-height 44px including label.
- RM: transitions off.

### 3.22 Dropdown menu (https://uiarc.dev/components/dropdown-menu)

- Trigger: 36px, 1px border, radius 18px, padding 0 12px, 14px/500, chevron 15px stroke 1.8 rotating 180 degrees on the spring curve. Open trigger = border-strong + muted fill, no scale.
- Menu: radius 26px, padding 5px, raised surface, floating shadow, min 12rem. Items: min-height 36px, padding 0 11px, radius 20px (26 minus 6), gap 10px, 14px. Icons 17px wide in secondary. Separator 1px `--border-subtle`. Destructive item = danger text and icon, highlight tinted 8% danger.
- One shared highlight element (muted fill) glides between items for mouse and keyboard, with no per-item hover. First appearance jumps, later moves glide.
- Enter: opacity 160ms, transform on the spring curve from 5px toward trigger + scale .97; items fade/offset in with 35ms stagger capped at index 4. Exit 130ms.
- Disabled item: opacity .45.
- RM: transitions off; opacity 120ms.

### 3.23 User menu (https://uiarc.dev/components/user-menu), catalog notes only

- 40px avatar trigger. Panel is 17.5rem wide, capped at viewport minus 24px. Opens as a bottom sheet on phones that follows a drag. Theme row min-height 44px. Rows fade in with a stagger. Highlight glides between rows. Radix `menuitemradio` groups for theme and status. `doc`.

### 3.24 Inline edit (https://uiarc.dev/components/inline-edit), catalog notes only

- Text is a native button "label: value" that turns into a field without moving. Reserves 66px at the end for save/cancel. Check draws on success, failures roll back. Errors in a polite live region. `doc`.

### 3.25 Hold to confirm (https://uiarc.dev/components/hold-to-confirm)

- For irreversible actions where the consequence is already on screen. Default hold 1200ms. Props: label ("Hold to delete project"), `confirmedLabel`, tone danger or neutral, `onHoldChange`.
- Structure: a button rendering its face twice: once on the surface and once inside an inverted fill clipped by `clip-path: inset(0 X% 0 0)`. The text therefore flips colour exactly at the moving edge.
- Look: 44px high, 1px border = danger 32% mixed into border, radius 18px, padding 0 20px, 14px/500, danger text on surface. Fill = danger with background-coloured text. Hover (idle) tint = danger 6% into surface. Icon 18px.
- Behaviour: pointer down starts a linear fill (duration x remaining fraction); release before the end rewinds on `smooth` with zero velocity. A quick re-press resumes from where it is. Moving more than 24px outside the button cancels. Press scale .97 (or .985 wide) on `snappy`. Keyboard: hold Space or Enter (auto-repeat ignored). Blur cancels. Touch completion triggers a 12ms haptic.
- Completion: label and icon morph into the done state, a check draws (320ms, 80ms delay).
- A11y: `aria-describedby` hint "Press and hold for 1.2 seconds to confirm. With a keyboard, hold Space or Enter." and a `role="status"` result. Context menu disabled to avoid long-press menu.
- RM: no scale, fill and rewind jump, 150ms fades.

### 3.26 Confirm morph (https://uiarc.dev/components/confirm-morph)

- Flow: idle, confirming, pending, done (optional undo), error (retry). One pill (36px high) whose width springs to the current face.
- Defaults: confirm label "Delete", cancel "Cancel", pending "Deleting", done "Deleted", error "Couldn't finish", retry "Retry", undo "Undo". `confirmTimeout` 6000ms, `resultTimeout` 5000ms.
- Look: pill, raised surface, resting shadow, 1px overlay border (an `::after`, so the border never changes measurements). Danger tone: 5% danger tint at rest, 10% while confirming with a soft 4px 14px red-tinted shadow, border mix 18% then 34%. Inner buttons 28px high (36 minus 8), pill, padding 0 11px, 14px/500. Primary confirm = danger fill with a 1px inset highlight; cancel is a quiet text button. Spinner 16px, 0.7s linear (1.6s under RM).
- Motion: faces slide in from the right on forward steps and from the left going back (x travel, `SLIDE` equivalent to 360ms visual duration bounce .06) with blur 4px and a 40ms opacity delay; outgoing face leaves the other way, faster (120ms), and is popped out of flow centred. Surface width: grow = 440ms bounce .18, shrink = 340ms bounce 0. Check disc scales in (340ms bounce .3), tick draws 280ms.
- Safety behaviours: focus lands on the safe choice (Cancel while asking, Undo/Retry on results). Escape, outside press or timeout return to rest. The timeout clock is invisible, a pointer resting on the control pauses it, a hidden tab pauses it. Announcement text goes to a polite live region ("Deleted. Undo is available.").
- RM: fades only, no press scale.

### 3.27 Copy button (https://uiarc.dev/components/copy-button)

- 36px, 1px border, radius 18px, padding 0 12px, 14px/500, 16px icon. Width never changes: a hidden measure reserves the widest label ("Copy" vs "Copied"), glyph-level label morph inside it. Copied icon in success, error in danger. Icon-only variant is a 36px square; plain variant has a transparent border.
- Press .97 in 160ms then spring release (580ms). RM: no press transform.

### 3.28 Toast (https://uiarc.dev/components/toast)

- Custom (Motion and lucide only, no Radix). Width min(100%, 26rem), padding 14px 14px 14px 16px, radius 26px, floating shadow, 1px border, gap 12px. Icon tile 30px circle with success 10% tint and 24% border. Title 14px/500 (line-height 1.35), description 14px secondary. Close 32px circle.
- Duration 4500ms. `role="status"`, `aria-live="polite"`, `aria-atomic`.
- Motion: enter on `morph` plus opacity 240ms; exit y 8px, scale .97, 180ms; swipe to dismiss with velocity handoff to the spring (a short swipe springs back at stiffness 420 damping 34; a throw exits on a 300ms no-bounce spring). Height springs on content change.
- Rule: toasts are for background work only. A foreground action confirms in place.

### 3.29 Alert (https://uiarc.dev/components/alert)

- Persistent inline message. Tones info, success, warning, danger. `role="alert"` for danger, `role="status"` otherwise.
- Look: flex, gap 12px, padding 16px, radius 18px, 1px border, surface, resting shadow. Icon 18px (margin-top 1px) coloured by tone; title 14px/500; description 12px secondary (margin-top 4px). Dismiss: 28px circle, negative margins to align, `aria-label` "Dismiss: title". Only the icon carries tone colour, the card itself stays neutral.
- Motion: presence animates height and opacity (height on `smooth`, opacity 240ms enter / 160ms exit), icon swaps on tone change, title and description Swap, height follows content changes.
- RM: instant presence.

### 3.30 Accordion (https://uiarc.dev/components/accordion)

- Hairline list, no cards: `border-top` on the group and `border-bottom` on each item (1px `--border`). Trigger min-height 50px (76px "lg" variant), padding 8px 0, 14px/500, chevron 17px muted turning foreground when open.
- Motion: panel height on `smooth`, opacity 240ms enter / 160ms exit, inner content y and blur settle. Chevron rotates 180 degrees on `snappy`. Closed panels leave the accessibility tree after collapse.
- RM: stills.

### 3.31 Dialog (https://uiarc.dev/components/dialog)

- Overlay oklch(10% 0 0 / .46) with 7px backdrop blur. Content width min(100vw - 32px, 440px), radius 34px, raised surface, floating shadow. Header padding 24px with a bottom hairline, title Inter 18px/500, description 14px secondary (margin-top 8px). Body padding 24px, 14px. Close button 32px, radius 18px, glass tint.
- Enter: overlay 240ms, content opacity plus rise 8px and scale .96, spring about 580ms (keyframe version: fade 160ms + rise on the spring curve). Exit: 150ms, y 4px, scale .98. While closing, clicks pass through so the trigger can reopen mid-exit.
- RM: 120ms linear fade in, 100ms out.

### 3.32 Stepper (https://uiarc.dev/components/stepper)

- Marker 28px disc with a 4px halo ring (accent-subtle); statuses: pending (muted number, 1px strong inset border), current (1.5px accent border, foreground number), complete (accent fill, accent-foreground tick), error (danger 10% fill, 1.5px danger border, 16% halo).
- Connector: 2px rounded track in `--border`, a fill in accent that scales along it on `smooth`; it keeps a clear gap from every marker and halo.
- Labels 14px/500 (muted, secondary when complete, foreground when current), description 12px muted, error text 12px danger. At container width under 30rem, labels collapse and the current step is named under the markers.
- Motion: marker content pops with `snappy`, tick draws 320ms; staggered by `stagger.line` (80ms). Height of caption springs. RM: stills.

### 3.33 Announcement bar (https://uiarc.dev/components/announcement-bar)

- Full-width strip: grid with mirrored side columns so the message stays page-centred, padding 6px 8px 6px 16px, 1px bottom border, muted fill (or inverted: foreground fill). 32px icon controls.
- Messages rotate every 6000ms, optional countdown timer (`role="timer"`, digits roll, `aria-live="off"` and a spoken label). Dismiss collapses the outer section height to zero so the page below eases up.
- Motion: message rises with y on a 320ms low-bounce spring, opacity 240ms, blur 280ms; leaving goes up 60%. RM: 200ms/120ms fades.

### 3.34 Avatar and avatar group (https://uiarc.dev/components/avatar)

- Sizes 28 / 36 / 48 / 88 px, pill, 1px border, muted fill, initials 12px/500 (10px at 28px, 23px at 88px). Status dot 10px (8, 12, 14) with a 2px surface ring and a 1px outer ring; online = success, offline = muted.
- Photo loads fade in from blur 4px only if the image was not cached, 240ms.
- Group: -6px overlap, 2px surface ring plus 1px border ring. Pointing at the stack fans it by 4px per index around the centre; the hovered person lifts and a 12px/500 inverted name pill floats above with no layout shift. Overflow chip "+N" tabular.

### 3.35 Number field, theme switch (catalog notes only)

- Number field (https://uiarc.dev/components/number-field): digit wheels, hold-to-repeat after 400ms ramping 150ms to 40ms per step, at a limit the value strains a few pixels toward the press and springs home and the refused button shakes once. Warning uses copy as well as colour ("10 seats, maximum"). Width min(100%, 196px). `role="spinbutton"`. No focus ring: the shell border darkens. `doc`.
- Theme switch (https://uiarc.dev/components/theme-switch): sun and moon trade places with rotation, scale and blur on `snappy`; a theme found at hydration swaps without motion. `doc`.

### 3.36 Line chart (https://uiarc.dev/components/line-chart), bar chart (https://uiarc.dev/components/bar-chart)

Line chart:

- Layout: legend of series toggles (32px pills, 14px, a 14 by 2.5px line swatch; a hidden series: swatch shrinks to .35 scaleX, label struck through and muted), plot, a right-hand value gutter (48px) and a date axis (26px) beneath.
- Gridlines 1px `--border`, baseline `--border-strong`, `shape-rendering: crispEdges`. Line 2px (1.75px dashed for forecast, dash 4 5). Area 9% of series colour. Axis labels 12px muted tabular. Max four rows of gridlines at "clean" steps (1, 2, 2.5, 5).
- Tooltip: 14px radius, raised surface, floating shadow (the one layer with a shadow), min 140px, padding 10px 12px, title 12px secondary, rows 14px with 10 by 2.5px swatch and 500 tabular values; fades and scales from .96 over 160ms; position on springs.
- Loading: series dim to .32 and breathe (opacity .22 to .45 over 1.4s alternate) or a soft band if there is nothing to keep on screen.
- Motion: first draw 840ms `ease.inOut` on view (30% visible). Range changes morph paths on shared x samples with `smooth` (not redraw). Gridlines and tick labels ride the scale and fade (240ms), so a taller range slides them down while new rows fade in above.

Bar chart:

- Headline readout above: kind 14px secondary, value Geist 36px/500 rolling (average at rest, scrubbed bar while exploring), when 14px muted; each line keeps its height so swaps never move the plot.
- Bars: fill = accent mixed 62% into surface (76% in dark), scrubbed neighbours fall to 24% (34% dark), active bar = full accent. Bar fills 58% of its slot, max 28px wide, data-end radius 4px. Dashed mean line (3 3) in secondary, its label in foreground 500.
- Value axis right (52px). Bars morph by key on range change; stagger min(35ms, 320ms/count).

### 3.37 Sortable data table (https://uiarc.dev/components/sortable-data-table)

- Wrapper: 1px border, radius 18px, overflow hidden, table min-width 560px so it scrolls inside the card. Header cells 44px high, 14px/500 muted (foreground when sorted); body rows 52px with `--border-subtle` hairlines, last row no border; numeric columns right aligned and tabular. Footer 44px with a top border and a muted count.
- Sorted column gets a muted tint band behind it (tint cells are opaque so rows crossing during sort do not show blending). Selected row: accent 8% mix. Sort hint arrow appears on hover/focus. Select box 18px, radius 5px, press .95.
- Rows are keyed so a sort animates the rows past each other.

### 3.38 Free blocks (https://uiarc.dev/r/<slug>.json)

Page header (https://uiarc.dev/components/blocks/page-header):

- A pinned header over a scrolling body, inside a 980px frame (radius 16px). Header: 16px top padding, bottom hairline drawn as an inset shadow. Row 1: breadcrumbs (14px muted, 14px chevrons in strong border colour) that swap with a compact title (16px/500) plus status badge when the page scrolls, overflow button, trailing actions. Intro: Geist 36px/500 title with a badge beside it, 14px secondary description max 60ch, 12px muted meta row with 500-weight strong values. Then a tab strip: 44px tabs, 2px accent underline, counts in muted tabular.
- Condense trigger: when the intro scrolls away, breadcrumbs lift out (y -8px, blur 2px) and the compact title rises in (y 14px, blur 4px). Secondary actions fold under an overflow menu as width narrows, width on `smooth`.
- Body lists use hairline-divided rows (`--border-subtle`), row heights 48 (milestones), 52 (activity, issues), 56 (files). A new row arrives with a 6% foreground wash that fades over 1.8s ("arrived"), no lasting marker. Completing an issue draws a strikethrough via text-decoration-color transition and swaps the circle for a check (scale .5 to 1).

Notification center (https://uiarc.dev/components/notification-center): popover panel 424px wide, radius 23px, header padding 23px 24px 18px with a 20px/500 title and a 21px count chip (radius 7px, muted), view switch (31px buttons, shared highlight), mark-all text button, list rows with an event icon column (24px, tone colour), 13px/500 title, 12px secondary preview, 11px muted tabular time, 6px unread dot in foreground. Rows cascade in with 35ms stagger. Details expand with height. Empty state: centred 14px/500 title, 12px secondary, an underlined text link action. Footer 46px with a top hairline. Bell badge: 19px pill in foreground with background text, 2px surface ring.

Empty states (https://uiarc.dev/components/blocks/empty-states): see Section 3.16. Tabs 30px high, radius 9px inside a 12px frame; stage keeps one aspect ratio (320 by 216) so scene changes never move the layout; strokes stay 1.5px (non-scaling).

Plan comparison (https://uiarc.dev/components/blocks/plan-comparison): two-plan table with billing toggle; prices count between periods; feature rows expand with a light blur; table/row/columnheader roles; prices `aria-live` + `aria-atomic`; footer `role="status"` names the chosen plan. Below 640px feature names span the row.

Stats band (https://uiarc.dev/components/blocks/stats-band): see Section 4.2.

### 3.39 Pro blocks: public text only (no source read, see licence)

Source returns 401 at https://uiarc.dev/r/pro/<slug>.json. The statements below come from the public catalog (https://uiarc.dev/r/catalog.json). They are the claims Arc makes, not verified behaviour. `doc` and `unseen`.

| Block | What Arc says it does | Useful idea for Headroom |
| --- | --- | --- |
| usage-billing | Spend line draws in once, projection and alert rules follow. Meter bars fill with a short stagger. After an upgrade every limit grows, so bars shrink and warnings clear in place. Plan card grows into a confirm sheet on one spring and folds back. Invoice download icon becomes spinner then check with no width change. Chart is an image with a spoken summary and a keyboard cursor. Each meter has role meter with value text that says when it is near or projected over. Warnings pair icon and words with colour. Sheet states "the preview takes no payment". Projection = average of last seven days carried to period end. At 700px chart and plan card share a row, meters beside alerts. | Projected-over-limit as a distinct meter state with words. A limit change should shrink bars in place, not remount. |
| billing-overview | Plan card morphs into a picker; selected highlight on a shared layoutId; totals roll; usage bars fill on view. Radiogroup picker. Quote updates in a polite live region. Stacks below 780px, meters single column below 700px. | Not needed |
| metrics-dashboard | Four KPI tiles that act as tabs (aria-selected), one chart that crossfades between metrics and ranges, range toggle with a sliding thumb, KPI underline slides. Deltas carry a text direction. Layout reflows by the block's own width: under 640px KPI tabs form 2 by 2; under 460px chart is 168px tall. | KPI tiles as tabs driving one chart |
| kpi-drilldown | KPI cards expand into a full detail chart with period comparison and breakdown table, then fold back into the same card. Ranges resampled to equal point counts so sparklines morph. Values roll. Previous period line fades with a Compare toggle. 3 columns above 760px, 2 to 520px, then 1. Rate metrics read changes in points; `lowerIsBetter` for churn. | Resampling for morphing; lower-is-better colouring |
| wallet-card | Balance counts over about 0.75s; card is a container-query root capped at 660px; balance is an aria-live region; hidden balance reads "Balance hidden". | Container-query cards |
| usage-forecast | Billing-period chart with forecast cone and a draggable budget line that dates the crossing. Budget line follows drags directly and settles on `snappy`. Plot and handle are role slider with plain-words valuetext. Alert rules are toggles with aria-pressed. | Budget handle and "crosses on <date>" |
| settings-page, integrations, api-keys, team-members, usage-pricing | Section nav with gliding indicator, save bar morphs in with a rolling changed-count (Cmd/Ctrl+S saves). Connect morphs to Connected, filters recount. Disconnect and revoke use hold-to-confirm. Secrets shown once with a copy button. Email chips fly into pending invites, seat count rolls. Plan found as sliders move. | Hold-to-confirm for Disconnect, one-time secret reveal |

---

## 4. Patterns for a quota and usage dashboard

### 4.1 Layout rules Arc states for dashboards (`doc`: composition.md, example-dashboard.md)

- One page container: max width 1200px, centred, padding 32px vertical and clamp(16px, 4vw, 32px) horizontal, grid gap 24px. Blocks and cards never add their own gutter. Children get `min-width: 0`.
- Header row: `h1` (Geist 36px/500, tracking -0.03em) left, tools right (segmented range control + one primary button), wrap with 16px gap, tools gap 12px.
- KPI row: `repeat(auto-fit, minmax(200px, 1fr))`, gap 16px, `align-items: stretch`, so equal heights. Skeleton placeholders min-height 112px.
- Cards: 1px `--border`, radius 34px, surface, padding 24px, overflow hidden. Wide tables scroll inside their card.
- Spacing: 16px within a group, 24px between regions, 32 to 48px between sections of long pages.
- Sibling cards must share edges and have a real 16 to 24px gap or be fused into one bordered group with hairline dividers. Never a 1 to 4px gap.
- Settings pattern: one bordered group per section with `--border-subtle` dividers between rows (label and description left, control right). Do not make a card per row. Same logic applies to a list of accounts or providers.

### 4.2 KPI rows and big numbers

Metric card (3.11) is the contained version. Stats band is the hairline version (`registry`):

- A description list: label is the term, number and caption are the descriptions. Grid with `repeat(count, 1fr)`, column gap 40px, row gap 64px. Each stat has fixed rows so numbers, labels and visuals align across the band.
- Number: Geist, clamp(40px, 1.4rem + 3cqi, 52px) in the CSS I read (Arc's catalog text says 36 to 72px, so the two disagree), weight 500, tracking -0.03em, line-height 1, tabular; unit (prefix/suffix) at .5em in muted on the same baseline. Label 14px/500 foreground, caption 14px muted. Context line cross-fades over the detail on hover or focus (opacity plus 4px y, 240ms).
- Motion: counts from zero with strong ease-out over 1.6s, staggered 90ms per stat, on first 50% in view. In the divided layout the top and bottom rules draw across and the hairlines grow. Visual under each number (sparkline, bars) draws after the number mostly lands. Reduced motion shows finals at once.
- Responsive: 2 columns under 760px container width, 1 under 420px.

### 4.3 Meters, legends and status

- Allowance = segments of one accent in decreasing strength plus an empty remainder, not a rainbow (usage-meter).
- Legend is the interactive key and the keyboard path: swatch, label, value, with hover/focus preview and pin. Wrap with an auto-fit grid of 108px columns.
- Status = a small pill in the panel header, not colour on the whole panel. Neutral "N free" at rest; tinted warning icon + "Almost full" at the threshold (default 90%); tinted danger icon + "N over" beyond. Pair every tone with an icon or words (design rule: never encode state with colour alone).
- Gauge variant: ring plus threshold labels ("Healthy", "Near limit"). Progress variant for task completion, not for quota (Arc says use usage-meter for allowances).
- Over-limit visuals: hatch plus marker line, so overage reads without colour.

### 4.4 Panel header with title and caption

- Arc has no dedicated "panel header" component. The consistent recipe across usage-meter, metric-card, line-chart, sparkline and dialog: title/label 14 to 16px weight 500 in foreground (or label 14px in secondary when a big number is the hero), caption 12 to 14px in muted or secondary below or beside it, status/range controls right-aligned on the same row, 12 to 16px gap.
- Cards place the title row first, then a 16 to 32px gap, then the number or chart. Metric card: top row, 32px, number, 16px, context sentence.
- Captions read as plain facts, sentence case, no trailing period on headings: "Workspace storage", "GB of 50 GB used", "vs previous period", "Updated 2 hours ago".
- No eyebrows, no uppercase labels above headings. If context matters it goes into the title or description (copy.md rule 2).

### 4.5 Hairline dividers versus cards

- Rule (design.md): group by proximity first, a 1px border second, a card only for a real boundary. A page region may be one card containing hairline-separated rows (`--border-subtle`, lighter than `--border`), or a hairline-bounded list with no card at all (accordion: top and bottom lines only).
- Row heights seen: 48, 52, 56px (lists), 44px header and 52px body (table), 40px legend row.
- Rows highlight with a faint foreground tint (4.5 to 6%) or `--surface-muted`, not with a border.
- Dividers inside floating layers use `--border-subtle`; outer frame uses `--border`; inputs and emphasis use `--border-strong`.

### 4.6 Loading, empty and error states

| State | Arc treatment | Source |
| --- | --- | --- |
| Loading | `skeleton` in the final layout, same dimensions, `aria-busy` on the region. Finite pulse: 1.8s per cycle, 90ms between lines, stops after 11 cycles. Charts: dim series to .32 and breathe, or a soft gradient band. Content swaps in with a 240ms rise (y 4px). | registry |
| Empty | Icon tile, short `h3`, one-sentence reason, one next step. Example: "No invoices yet. Your first invoice appears after the trial ends." | copy.md |
| Error | Inline alert next to the cause, danger tone, `role="alert"`, with a retry. Not a toast. Message says what happened and how to fix. | composition.md, copy.md |
| Success | Confirm in place: button label, row or value changes. Toast only for background work. | motion.md |
| Disabled | Explain nearby or hide, except an unchanged Save | composition.md |
| Long content | Wrap or truncate with the full value reachable | composition.md |
| Unknown value | Not stated by Arc. Headroom rule: unavailable is unknown, not zero, so it needs its own visual (see Section 5) | n/a |

### 4.7 Confirm flows for risky actions

Decision table (components.md):

| Action | Pattern |
| --- | --- |
| Reversible delete | `confirm-morph`: the trigger itself becomes "Delete 3 files?" + Cancel + Delete, then a spinner, then "Deleted" with Undo. Focus defaults to the safe button. Timeout 6s while asking, 5s on result, paused while hovered. |
| Irreversible, consequence already visible | `hold-to-confirm`: 1.2s hold, linear fill, early release rewinds on a spring, keyboard hold supported. Used by Arc Pro blocks for Disconnect and Revoke. |
| Consequence needs explaining | `dialog` with a title naming the object and the consequence ("Delete Harbour? Its 12 files are removed for everyone."). |
| Never | A modal for every delete. |

For Headroom: a consume or purchase action must be its own explicit user action, so hold-to-confirm or confirm-morph with a named object is the fit. Monitoring controls (refresh, copy) use the Action button pattern with in-place Saved/Saving style states.

### 4.8 Charts for time series (relevant to usage history)

- Line: 2px stroke, 9% area, 1px hairline gridlines at clean steps (max four rows), right-hand value gutter, sparse date axis, scrub tooltip with the only shadow, series toggle legend, forecast as dashed 1.75px line.
- Bar: 58% fill of slot, max 28px, 4px data-end radius, dashed mean line, headline readout above the plot that switches to the scrubbed bar.
- Both morph by stable key across range changes instead of redrawing. Draw-in once on view (840ms `ease.inOut`).
- Series palette is the shared 4-colour set; one hue for one data series that matters, neutral for the rest (accent rule).

---

## 5. Synthesis

### 5.1 Design language in 20 rules

1. Neutral chrome: pure grey surfaces (chroma 0), one accent that is spent only on active, selected, progress and the one data series that matters.
2. Hierarchy comes from size, colour (foreground, then secondary, then muted) and spacing. Weights 400 and 500 only.
3. Two faces: Geist for 30px and up and big numbers, Inter for everything else. Display tracking -0.03em, body -0.01em.
4. A fixed 9-step size scale (12 to 72px). Most UI lives at 12, 14, 16 and 36 (numbers).
5. Large concentric radii: 18 controls, 26 panels, 34 cards, pill for tags. Inner radius = outer minus padding.
6. A 4px grid; 16 inside a group, 24 between regions, 32 to 48 between sections.
7. Cards rest on a 1px border, no shadow. Shadow only on floating layers (menus, popovers, dialogs, toasts, tooltips, chart tooltips).
8. Three border strengths: subtle (inside a surface), default (surface edge), strong (inputs, hover, emphasis).
9. Hover is a fill change to `--surface-muted` (or a 4 to 6% foreground wash), never a border colour jump alone, and only on fine pointers.
10. Selected is a quiet accent tint (about 10 to 16% mixed into the surface) plus an extra signal (check, underline, filled swatch), never colour alone.
11. Status colours are used only for status, always with an icon or words. Colour goes mostly on the icon with a faint tint behind (10 to 14% mix).
12. Tabular figures for every number that changes or aligns. Units sit smaller and muted beside the number.
13. Sentence case everywhere, no uppercase, no eyebrows, no em dashes, no heading period. Buttons are verb plus object.
14. Lucide icons at 16, 20 or 24px with stroke 1.75 (14 to 18px used inside dense controls), plain beside the label, `aria-hidden` when decorative. No icon in a tile (except the empty-state tile and status).
15. Every control height snaps to 28, 36, 44 or 50px; 44px is the touch default.
16. Text that changes never jumps: Swap transition, reserved widths, tabular digits, widths and heights that spring.
17. Confirm in place: the button or row shows the new state. Toasts only for background work.
18. One primary button per surface (inverted foreground fill, not the accent).
19. Interactive keys: legends and lists have a roving tab stop with arrow keys; hover preview, focus preview, press to pin, Escape to clear.
20. Both themes and two accents must work. Dark mode is a token swap, not a separate design: surfaces step by about 2.5 lightness points, status colours get brighter, shadows get darker.

### 5.2 Motion system

Shared table:

| Layer | Value | Use |
| --- | --- | --- |
| Instant | 120ms | press-down, tiny fades, RM fades |
| Fast | 160ms | hover colour, small fades, exits of text |
| Exit | 180ms (JS), 110 to 150ms (overlays) | leaving layers |
| Standard | 240ms | enters of text/panels |
| Considered | 480ms | first-reveal only |
| Draw | 840ms (480 x 1.75), `ease.inOut` | line and ring first draw |
| Spring snappy | 0.26s visual, bounce .12 (k about 406, c about 35) | presses, thumbs, small indicators, icon pop |
| Spring smooth | 0.40s, bounce 0 (k about 171, c about 26) | panels, heights, progress, any value that reports state |
| Spring morph | 0.42s, bounce .16 (k about 156, c about 21) | shared highlight, width following text, chart arcs |
| CSS spring | `--ease-spring` over 580ms, peak overshoot about 0.6% | popover/menu transform, release of CSS presses |
| Ease enter | cubic-bezier(.16, 1, .3, 1) | arrivals |
| Ease standard | cubic-bezier(.22, 1, .36, 1) | colour, opacity, exits |
| Stagger | 35ms per list item, 40ms per word, 16ms per character, 80ms per line, 70 to 90ms per meter/stat | total under about 400ms |
| Blur | 2px (exit), 4px (enter), 8px (text) | brief crossfades only |

Enter and exit grammar:

- Text: enters from 0.3em below with 4px blur, 240ms enter ease; leaves 0.3em above with 2px blur in 160ms standard ease. Numbers use direction: bigger rises from below, smaller drops from above.
- Icons: scale .6 and 2px blur on `snappy`, opacity/blur on a 160ms tween.
- Floating layers: start about 5px toward their trigger, scale .97, opacity 0; open with a 160ms fade and a transform on the spring curve; leave in 110 to 150ms with half the travel and scale .98.
- Regions (alert, accordion, tab panel, skeleton content swap): height on `smooth` plus opacity 240ms in and 160ms out; content y 4px.
- Highlights (segment, tab, menu row): one shared element glides on `morph` or `snappy`; items themselves never scale or change weight.
- Exits are always faster than enters.
- Everything reversible runs on springs written as stiffness and damping, so reversing mid-flight keeps velocity.

What never animates:

- Anything on a keyboard-repeat path (arrow navigation in lists does not animate, only highlight glide for menus). The motion doc says repeated actions many times a minute do not animate.
- Layout properties other than the information itself: width and height animate only when the size change is the content, and always on a spring. Everything else uses transform and opacity (and short blur).
- Routine product UI never uses visible bounce. State reporters (switch thumb, panel height, progress fill, value) use bounce 0.
- Scroll-reveal on every section, and loops that are not live status. At most one orchestrated entrance per page. The skeleton pulse is the one allowed loop and it is finite.
- A press-scale on a popup anchor.
- Any `key` change on an animated node (a remount restarts the animation and loses focus).

Triggering:

- In-view: `useInView` with `once: true`; amounts: counter 60%, gauge/stats-band 50%, sparkline 50%, usage-meter 40%, donut 35%, line chart 30%, bar chart 35%.
- First-reveal is slower than later updates (gauge 768ms vs `smooth` 400ms; donut .72 vs .5s).
- Orchestration: values retarget on one spring each; first change starts one frame after render.

Reduced motion:

- Every item has a branch. Keep end state, focus and feedback; remove travel, loops, parallax, autoplay. Counters jump to values, panels appear at full height, highlights jump, charts show the finished line, press-scale off, springs become 0 duration, text swaps become 100 to 150ms opacity fades. Spinners keep a very slow or static mark (0.01ms animation or 1.6s). Reduced-motion state is read after hydration so first render matches the server.
- CSS items use `@media (prefers-reduced-motion: reduce)` to zero transitions, drop transforms on popovers to an opacity-only 90 to 120ms linear fade.

### 5.3 Micro-details list

Sizes:

- Heights: badge 26 (sm 22), segmented button 36, tab strip 44 (page-header) or 36 (tabs component), dropdown item 36, menu padding 5px, legend row 40, table header 44 / row 52 / footer 44, accordion trigger 50 (76 large), stepper marker 28, avatar 28/36/48/88, switch 42 by 24 with 18px thumb, bar track 14, progress track 7, notification unread dot 6.
- Icon sizes: 16 (default), 12 to 14 (inline status, check in chip), 17 to 18 (menu/button icons), 24 (empty state glyph). Stroke 1.75 (checks 2 to 2.5, status icons 2).
- Chip height 36 with 14px side padding; badge pill 10px side padding; check slot 18px.
- Swatches: 10px with 3px radius (meter), 10px circle (donut), 14 by 2.5 line (line chart).
- Legend hover fill radius 12px; legend items min 108px wide.

Typography:

- Numbers: tabular always; units 0.5em, muted, same baseline; percent sign in the gauge is secondary at .5em.
- Captions: 12px muted; "x of y used" form; one line with ellipsis. Short, factual, sentence case.
- Heading balance: `text-wrap: balance` on titles and centred copy, `text-wrap: pretty` on descriptions. Reading measure 34ch (card description), 40ch (empty-state line), 60 to 65ch (long text), 18rem (empty-state description).
- Tracking: -0.03em display, -0.025em for the 20px notification title, -0.01em body, -0.005em in confirm-morph.

Colour:

- Tint recipe: `color-mix(in oklch, <tone> N%, <surface>)` with N = 10 to 14 for backgrounds, 24 to 32 for borders, 6 to 8 for faint washes, 62/36/22 for categorical steps of one accent, 5 to 6 for hover washes from foreground, 7 for track fill.
- Danger confirm tint: 5% at rest, 10% while asking. Danger hover wash 8%.
- Dim states: non-highlighted segments .28, legend .45, donut segment .45.
- Disabled opacity: .45 to .5 (menu items .45, switch/dropdown .5, button .52, copy .5, action .7).

Interaction:

- Hit target 44px on touch, adjacent targets at least 8px apart. `-webkit-tap-highlight-color: transparent` on custom controls.
- Tooltip delay 250ms with 300ms skip window; hover card 500ms/140ms; hold 1200ms; confirm timeout 6s/5s; toast 4.5s; announcement 6s; skeleton 11 pulses.
- Numeric stepper repeat: after 400ms, ramp 150 to 40ms.
- Dismiss buttons are 28 to 32px circles with negative margins so the glyph aligns with the edge.
- Shadows: floating layers use `--surface-raised` background plus floating shadow plus a 1px border (all three).

Copy:

- Titles: "Workspace storage", "Signups", "Key numbers" (section aria-label), "Open issues".
- Captions: "vs previous period", "GB of 50 GB used", "Updated 2 hours ago".
- Statuses: "Almost full", "Over limit", "N GB free", "Healthy"/"Near limit" bands.
- Errors: "We could not save your changes. Check your connection and try again." Retry button "Try again".
- Empty: "No projects yet" + "Projects you create or join appear here." + "Create project".
- Destructive: "Delete Harbour? Its 12 files are removed for everyone." Confirm button repeats the verb ("Delete").
- Async verbs go progressive ("Saving", "Deleting", "Restoring") then past tense ("Saved", "Deleted").
- Numbers: "$1,240", "12.5%", "3 of 5 seats", "9 to 17" (never em dash), dates "Sep 24", "2 hours ago".

### 5.4 Things to adopt, adapt or skip for Headroom

Adopt:

- Segmented one-accent meter with a hatch for overage; limit marker; legend as keyboard path. Needs an "unknown" state that Arc lacks: render an unfilled hatched or dashed track with the words "Unknown" (Headroom rule: unknown is not zero).
- Status pill in the panel header; icon plus words for state.
- Swap, reserved widths, tabular digits, odometer or count-up for numbers. For a monitor that refreshes often, prefer the count-up on a `smooth` spring (cheaper, no per-digit DOM) and keep the odometer for the headline only.
- Hairline-divided rows inside one bordered group for the accounts list.
- Skeleton in final layout; inline alert with retry for provider errors; confirm-morph and hold-to-confirm for any mutating action.
- Evidence labels (official/private, documented/validated) are not in Arc. Use a Badge-style neutral pill with a tooltip, and keep it separate from tone colours so tone stays status-only.

Adapt:

- Radii: 18/26/34 are large for dense data panels. Arc's own blocks drop to 12 to 23px. Pick one set and stick to it.
- Accent: Arc's default is neutral grey with the primary button inverted foreground. This suits a calm monitoring tool. Using one real accent only for the active series and selection fits the "accent with intent" rule.
- Per-provider colours: Arc says third-party brand marks use real brand colours, never grey.

Skip or fix:

- Arc removes every focus ring as a product decision and tells reviewers not to report it. This is an accessibility regression against WCAG 2.4.7 and 2.4.11 style expectations. Arc substitutes hover-style fills, which are not equivalent for keyboard users on non-list controls (the switch, button, chip). Headroom should keep a visible focus indicator (a 2px inset or offset ring using `--border-strong` or the accent) while borrowing everything else.
- Pro blocks cannot be recreated from source. Rebuild the ideas (projected usage, budget handle) from the public descriptions only.

### 5.5 Gaps, uncertainties and notes

- Rendered visuals not seen. No screenshots were captured, so proportions, optical alignment and colour rendering are inferred from CSS only. A coordinator wanting pixel truth should open https://uiarc.dev/components/usage-meter in a browser.
- Not read in source: user-menu, inline-edit, number-field, theme-switch, text-morph, timeline, notification-center TSX, plan-comparison TSX, stats-band TSX and the page-header TSX beyond grep. Their entries rely on the catalog's `motion`/`accessibility`/`responsive` text (`doc`), or CSS only.
- Pro blocks: source unavailable (401), per the licence. Only catalog text recorded.
- `stat-card`, `action-swap`, `theme-switcher` return 404 in the registry even though skill files mention the first two. Docs and registry disagree.
- The licence page is a draft pending legal review, so terms may change. MIT for free items is nonetheless stated in the registry-facing text and in the public repository per that page. I did not fetch the GitHub repository's LICENSE file.
- Spring stiffness/damping values for `smooth`, `snappy`, `morph` are my derivation from a helper formula in Arc's source, and should be treated as an approximation of Motion's internal conversion.
- Arc skill guidance and component source disagree in places: tooltip max width 15rem and `--duration-spring` 580ms are in the CSS but not in the docs table; the doc says "no popover scale on anchors" while a few blocks (confirm-morph) scale a non-anchor surface to .96. Arc says weights are only 400 and 500, and the registry follows that: across all fetched registry items there are 81 uses of weight 500, 13 of 400 and none of 600 or above.
- Components assume React 19 style APIs (ref as prop, `useEffectEvent`) and Motion. A non-React port loses layout animation (`layoutId`, `layout="position"`), which is the part that is hardest to reproduce: segmented highlight, chip lag, card quick look, text-morph glyph glide. CSS alternatives: anchor positioning or FLIP by hand.
- Browser features used that need a check against Headroom's targets: `@starting-style`, CSS `linear()` easing, `color-mix(in oklch)`, relative colour syntax (`oklch(from ...)`), `:has()`, `overflow: clip`, container queries and individual `scale`/`translate` properties.

### 5.6 The ten findings most worth acting on

1. Free items are MIT (author notice "Copyright (c) 2026 Elia Kuratli"), Pro is proprietary and gated. Pro blocks that match Headroom (usage-billing, usage-forecast) cannot be reconstructed. The licence page is a draft.
2. `usage-meter` is almost a direct template: one accent in decreasing strength, 14px pill track, 2px gaps, hatch plus limit marker for overage, status pill, interactive legend, rolling totals.
3. State is never colour alone, and the tone lives on the icon plus a 10 to 14% tint, not on the whole surface (badge, status pill, alert, meter).
4. A single text transition ("Swap": 0.3em rise, 4px blur, 240ms in, 160ms out, popLayout, direction-aware) plus reserved widths and tabular digits is why nothing jumps. Re-declared in every component.
5. Five spring presets cover everything; `smooth` (0.4s, bounce 0) for anything reporting state, `snappy` for presses, `morph` for shared highlights. Springs are rewritten as stiffness/damping so retargeting keeps velocity.
6. Surfaces: 1px border, no shadow at rest; one floating shadow stack for floating layers; 3 border strengths; light mode surfaces are all pure white.
7. Press feedback: scale .97 (.96 icon, .985 wide) in 120ms, spring release; popup anchors never scale, they answer in colour.
8. Risky actions: confirm-morph (inline pill with safe-focus defaults, 6s timeout, undo) and hold-to-confirm (1.2s linear fill, spring rewind, keyboard hold). Never a modal for every delete.
9. Loading, empty, error rules: skeleton in final dimensions with a finite pulse (11 cycles), empty state with one next step, inline retryable alert, confirm in place instead of toast.
10. Arc removes all focus rings by decree. Headroom should not copy that; everything else about interaction states is portable.
