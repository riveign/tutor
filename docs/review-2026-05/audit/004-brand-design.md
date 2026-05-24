# Tutor — Brand & Design Audit

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Brand Foundations](#1-brand-foundations)
3. [Design Tokens (Light + Dark)](#2-design-tokens-light--dark)
4. [Component Patterns](#3-component-patterns)
5. [Gallery / Deckbuilder UI Patterns](#4-gallery--deckbuilder-ui-patterns)
6. [Accessibility](#5-accessibility)
7. [Visual Polish & MTG-Specific Treatment](#6-visual-polish--mtg-specific-treatment)
8. [Brand Alignment with Audience](#7-brand-alignment-with-audience)
9. [Recommendations Backlog (Brand & Design)](#8-recommendations-backlog-brand--design)

---

## Executive Summary

Tutor's Phase 1 brand work is unusually well-articulated for a project at this stage. The "Field Manual" direction is a defensible, distinctive position (cream + graphite + working-green/red, slab serif + Inter + JetBrains Mono) that *materially* differentiates Tutor from the marketplaces it's positioning against. The voice work in `branding/brief.md` is clear, has anti-voice rules, and the do/don't examples are concrete enough to copy-edit against. Tokens are committed as a single CSS file, mapped into Tailwind via `theme.extend`, imported from `web/src/index.css`, and the scaffold already consumes them on the one screen that exists (the health probe in `App.tsx`).

The gaps are predictable for the phase: there is **no logo**, **no favicon**, **no Scryfall-attribution surface**, **no logo lockup mark**, **no WUBRG mana-token system**, **no rarity / format / role / bracket badges**, **no shadcn/ui setup**, **no component primitives**, and **no wireframes** for any of the three load-bearing views (collection grid, deck list, card detail). DECISIONS.md and the brief both refer to widgets that don't yet exist (`--color-mana-w`, mana-cost displays, role badges). The Scryfall attribution promised in the do/don't list isn't wired into the only existing page.

The most important finding: **the brief claims "All paired tokens meet WCAG AA against their intended surface" — but they don't.** Verified contrast on the light theme:

- `fg-subtle` (#8A8A82) on `surface` (#F1ECDE) = **2.95x** (fails normal text 4.5x).
- `accent` (#5F7A3C) on `surface` = **4.10x** (fails normal text; passes large-text and UI-component 3:1).
- `warning` (#B07E26) on `surface` = **3.04x** (fails normal text; passes UI-component 3:1).
- `border` (#D4CDB6) on `surface` = **1.35x** — borders are effectively invisible against the canvas and fail WCAG 1.4.11 (3:1 for UI components).

Dark theme is much healthier: only `fg-subtle` lands in large-only territory, and the `border` value (1.47x) has the same UI-component-contrast issue as the light theme.

### Top 8 Recommendations (preview)

1. Fix the four sub-WCAG-AA token pairs (block on this — the contract is a written promise).
2. Ship `branding/logo.svg` + favicon + 32/192/512 PWA marks.
3. Add WUBRG / mana tokens and a `Mana` component before the card-detail view lands.
4. Add role / rarity / format / bracket badge primitives with shape-not-only-color signals.
5. Initialize shadcn/ui (Button, Input, Dialog, Tabs, Tooltip, Toast, ScrollArea) on top of tokens.
6. Wireframe the three load-bearing views (collection grid, deck list, card detail) before Phase 6.
7. Add Scryfall attribution surface (footer + per-image alt-text policy).
8. Self-host the three Google Fonts (Inter, Roboto Slab, JetBrains Mono) for performance + offline-first dev.

### Next Steps

- Land the token-contrast fixes in the same PR as the audit so the "AA-everywhere" claim becomes true.
- Stand up `branding/logo.svg` plus 16/32/180/192/512px favicons; wire into `<head>` and the React manifest.
- Initialize shadcn/ui and produce a single `Button`/`Input`/`Badge` reference page that consumes tokens, so the engineer can mirror it for every subsequent screen.
- Draft low-fi wireframes (Figma or even tldraw) for collection grid, deck list, and card detail before Phase 6 implementation begins.

---

## 1. Brand Foundations

**What exists:**

- `branding/brief.md` — 119 lines. Voice (5 adjectives + anti-voice), audience, positioning statement, do/don't with concrete examples, Direction C palette table (light + dark), type stack, iconography rules, component cues. Directions A and B documented as rejected alternatives.
- `DECISIONS.md` — 96 lines. Brand direction is logged with rationale ("C wins on distinctiveness without sacrificing voice"). Type stack and WUBRG separation are logged.
- `.claude/agents/tutor-brand-design.md` — the agent charter restates positioning, hard constraints, and deliverables.
- The brand voice is enforced in the *only* shipped UI string: "Your library's deckbuilding companion." — on-brand.

**What's missing:**

- **No logo file.** The agent charter lists `/branding/logo.svg` as a deliverable; `Glob` returns no `.svg` files anywhere in the repo. The single existing screen has no wordmark — just an H1 with "Tutor / v0.1.0" in mono.
- **No favicon.** `web/index.html` has no `<link rel="icon">`. Browsers will fall back to the default Vite icon. There is no PWA manifest, no Apple touch icon, no 192/512 marks.
- **No Scryfall attribution surface.** The brief says "Credit Scryfall as the data source wherever card data appears." No footer, no per-image attribution, no policy document. This becomes a blocker the moment card images render.
- **No content/microcopy library.** Voice is documented, but there's no inventory of strings (empty states, error states, toast templates, button labels) to keep voice consistent as the surface area grows.
- **No "logo do/don't" or wordmark spec.** Even before the logo exists, there's no clearance / sizing / monochrome / inverse spec.

**Verdict:** Brief and decision-logging are strong — among the best of any early-stage project I've audited. Logo / favicon / attribution are the obvious next deliverables; treat them as P1 alongside any visual surface that ships card data.

---

## 2. Design Tokens (Light + Dark)

**What exists:**

- `branding/tokens.css` — 156 lines. Surfaces (3 tiers), foreground (3 tiers), borders (2 tiers), accent + hover + on-accent, signals (success/warning/danger/info), focus alias, type families (sans/serif/mono), type scale (xs–4xl), line heights, 4px spacing scale, 6 radii, 4 shadow tiers, motion durations + standard easing.
- Dark theme variables declared inside `[data-theme="dark"]` and duplicated in `@media (prefers-color-scheme: dark)` block (with the `:root:not([data-theme="light"])` guard — good pattern).
- `@media (prefers-reduced-motion: reduce)` zeroes motion durations — good.
- Tailwind wiring (`web/tailwind.config.ts`) reads CSS vars via `theme.extend.colors|fontFamily|borderRadius|boxShadow|transitionDuration`. Classes like `bg-surface-raised`, `text-fg-muted`, `text-signal-danger` already work in `App.tsx`.
- `web/src/index.css` imports `../../branding/tokens.css` directly — single source of truth, no duplication.
- `font-variant-numeric: tabular-nums` set globally on `.font-mono`, `table`, `[role="grid"]` — exactly right for card-data tables. Already done. Nice.

**What's missing / wrong:**

- **The dark-theme block has no duplicated `--color-focus` definition.** In dark, `--color-focus` still resolves to `var(--color-accent)`, which works because `--color-accent` is itself redefined — but the indirection is fragile. Be explicit.
- **No `--color-mana-{w,u,b,r,g,c,multi}` tokens.** The brief says "WUBRG colors will get their own dedicated tokens when needed." That moment is approaching fast (any card-detail or deck-row view).
- **No `--color-rarity-{common,uncommon,rare,mythic}` tokens.** Rarity is one of the highest-utility visual signals MTG players read; you'll want a token-level vocabulary, even if you render it with shape rather than color.
- **No `--color-format-{standard,modern,commander,...}` tokens** for format-legality chips.
- **No `--color-bracket-{1..5}` tokens** for Commander bracket badges (project scope explicitly tracks brackets).
- **No spacing alias for "card-grid gap" / "deck-row stripe."** Spacing is currently raw 4px scale; named tokens for the two highest-traffic layouts pay for themselves.
- **No "z-index scale" token group.** Modals, popovers, drag-overlays, sticky deck-row totals will all collide if z-indexes are ad-hoc.
- **Light theme tokens fail their own contract in four places** (see §5 Accessibility).
- **No motion easing variants** (in vs out vs in-out). Single `--easing-standard` is fine for V1 but will get reached for; document the policy.
- **No `--breakpoint-*` tokens** echoed from Tailwind. Not required, but if responsive breakpoints become brand-relevant (gallery columns), expose them.

**Verdict:** The token *contract* is mature and the *wiring* is exemplary — the one-source-of-truth + `theme.extend` pattern is the right call. The contract itself has one true bug (the unmet AA promise) and several near-term gaps (WUBRG, rarity, format/bracket badges) that should land in the same milestone as the components that need them.

---

## 3. Component Patterns

**What exists:**

- Nothing yet, beyond the inline JSX in `App.tsx` for the health probe (one header, one `<section>` panel, one `<dl>`).
- The implementation uses Tailwind utility classes against tokens directly. No reusable components. No `components/` directory under `web/src/`.

**What's missing:**

- **shadcn/ui is not installed.** No `components.json`, no `components/ui/` folder, no `@radix-ui/*` packages in `package.json`. Both the agent charter and DECISIONS.md commit to "Tailwind + shadcn/ui" but nothing has been generated.
- **No primitive set.** Even the canonical-eight (Button, Input, Label, Select, Dialog, Tabs, Tooltip, Toast) are absent.
- **No MTG-domain components.** The agent charter calls out card-gallery item, deck-row, role badge, tag pill, filter chip, drag handle, and a mana cost / pip widget. None exist.
- **No Storybook / component playground.** Hard to validate token + component pairings without one — even a single `/_dev` route would help.
- **No header / shell layout.** No nav, no app frame, no responsive container conventions. `App.tsx`'s `max-w-2xl px-6 py-16` is a one-off.

**Verdict:** This is the largest gap by surface area. The way to close it efficiently: `pnpm dlx shadcn-ui@latest init` (consuming our tokens — the CSS-vars-as-Tailwind-colors pattern they prescribe is already the pattern in `tailwind.config.ts`), generate the canonical primitives, then layer the MTG-specific custom components on top. Do this *before* the collection / deck phases ship, not during.

---

## 4. Gallery / Deckbuilder UI Patterns

**What exists:**

- The strategic intent is documented (positioning, "visual-first is a product non-negotiable").
- The MTG-expert and PM agents have established the data shape (oracle/printing split, role/effect tags, brackets) that the views will need.
- The agent charter for brand-design names the four flagship views: collection grid, deck row, card detail, drag-and-drop deckbuilder.

**What's missing:**

- **Zero wireframes, mocks, sketches, or even prose breakdowns.** No `branding/wireframes/`, no Figma URL in DECISIONS.md, no IA / information-architecture document.
- **No card-gallery item spec.** Aspect ratio? Hover behavior? Selected state? Multi-select affordance? Foil / etched indicator? Set + collector number placement?
- **No deck-row spec.** Density target? Quantity stepper position? Role-tag chip placement? Sideboard / mainboard separator? Total count + curve sparkline location?
- **No card-detail layout.** Image left vs top? Faces tab vs side-by-side? Tag list density? Where the "why is this in my deck?" rationale lands?
- **No empty / loading / error states.** Especially relevant given the brief's voice ("calm, technical, no hype").
- **No print/share template.** Deck lists are routinely exported / posted; a brand-on print template would be a small, high-leverage artifact.

**Verdict:** This is the most strategically risky gap. Effect-tag / role-based search and KB-cited deckbuilding are the *differentiators*, and their value is only legible if the views surface them clearly. Wireframing the three core views before Phase 6/7 begin is cheap; reworking them after the engineer has shipped a stock list is not.

---

## 5. Accessibility

### Color contrast: verified, with material findings

Running luminance + WCAG formula on every paired token in the brief:

**Light theme — failures vs the brief's "All paired tokens meet WCAG AA" claim:**

| Pair | Ratio | WCAG normal text (4.5x) | WCAG UI / large (3.0x) |
|---|---|---|---|
| `fg-subtle` on `surface` | 2.95x | FAIL | FAIL |
| `fg-subtle` on `surface-sunken` | 2.61x | FAIL | FAIL |
| `accent` (#5F7A3C) on `surface` | 4.10x | FAIL (large-only) | PASS |
| `warning` (#B07E26) on `surface` | 3.04x | FAIL (large-only) | PASS |
| `warning` on `surface-raised` | 3.26x | FAIL (large-only) | PASS |
| `border` on `surface` | 1.35x | n/a | FAIL (non-text UI) |
| `border-strong` on `surface` | 2.24x | n/a | FAIL (non-text UI) |

**Dark theme:** All foregrounds pass, including `fg-subtle` (3.63x — large-only). `border` (1.47x) and `border-strong` (2.32x) on `surface` fail UI-component contrast 1.4.11. (Note: WCAG 1.4.11 exempts *purely decorative* borders, but the brand calls them "first-class" — they carry information.)

**Implications:**

- The brief's promise is currently aspirational, not factual.
- `fg-subtle` on the most common surface fails for normal text — and is currently *used* for the brand "Tutor / v0.1.0" eyebrow on `App.tsx`. The mono small-caps treatment doesn't qualify as "large text" under WCAG (large = >=18.66px regular or >=14pt bold).
- `accent` as primary action / link color on the canvas surface fails 4.5x. This is a common gotcha — the green is fine *on white buttons* but not as a body-text link color.

### Other a11y observations

- **Focus styles are documented in the brief** ("Focus rings: 2px solid `--color-accent`, 2px offset") but **not implemented anywhere**. No `:focus-visible` rules in `tokens.css` or `index.css`. Tailwind preflight removes default outlines but nothing replaces them. With the accent at 4.10x on surface, even the documented spec is borderline.
- **Color is sometimes the only signal.** The signal tokens (`signal-success`, `signal-warning`, `signal-danger`, `signal-info`) currently rely on hue alone. The brief calls this out ("pair color with shape, icon, or label") but no patterns enforce it. Health probe error reads as red text — no icon.
- **Reduced motion is wired** (`@media (prefers-reduced-motion: reduce)` zeroes durations). Good.
- **`aria-live="polite"` is used** on the health probe panel. Good single example.
- **No skip-link, no landmarks beyond `<main>`, no keyboard navigation testing** documented.
- **No min-tap-target audit.** The deck-row +/- quantity stepper will need 24x24 minimum (or 44x44 on touch).
- **No reduced-data / image-off mode.** Card images dominate; explicit text-only fallbacks (oracle text, mana cost) need design intent.

**Verdict:** This is where the audit's recommendations are most load-bearing. The promised WCAG AA contract is not yet met. Fixing it is a half-day of token tuning, but it has to happen *before* downstream components consume the failing tokens.

---

## 6. Visual Polish & MTG-Specific Treatment

**Strengths:**

- The brief's directive — "Tables and lists are first-class — they are the brand" — is exactly right for the audience. Spike-leaning Commander brewers read text; visual chrome is noise.
- Tabular numerals globally enabled. Card data tables will look right by default. This is a quietly excellent decision.
- Slab serif (Roboto Slab) for display is genuinely distinctive in the MTG-tools ecosystem (which leans either gothic-fantasy or generic-SaaS). It buys instant brand recognition.
- Shadows are deliberately restrained ("this is paper, not glass"). Consistent with the "field manual" mood.
- The decision to shift signal colors *outside* the WUBRG palette is sophisticated — it preserves color-identity as a domain signal and prevents accidental "green button" = "green card" confusion.

**Gaps:**

- **WUBRG / mana symbol system absent.** Mana costs will need to render somewhere on Day 1 of card detail. The brief says no Wizards trademarks (so no `{R}` font reuse) and the iconography rules say "Card backs evoked through abstract negative space — never depicted." A custom mana-pip system is required *and* unspecified.
- **Rarity treatment unspecified.** Common/uncommon/rare/mythic is information-dense; how do we render it without the gemstone metaphor (which Wizards uses)? Stripe, dot pattern, weight of a slab-serif letter?
- **Foil / etched / borderless / showcase printing variants** — players care about these. No visual policy.
- **Type set / pack indicator** — collection provenance is a stated V1 differentiator. No symbol system.
- **Bracket badges (1–5)** — Commander bracket is in the schema. No badge spec.
- **Role / effect-tag chips** — the V1 differentiator. The brief mentions "tag pill" once. No spec.
- **Curve / role / pip charts** — called out as part of the visual-first non-negotiable; no chart-styling guidelines, font choice in chart axes/legend, or color-vs-pattern policy.
- **Logo cue: the brand promise is "search the library."** A "tutor" search-mark could be a quietly excellent logo (open book + magnifying motion, or a slab-serif T treated as a bookmark). No exploration committed.
- **Icon set undefined.** Brief says "Single-weight (1.5px) line icons; technical-drawing posture." That's a style — but no icon library is chosen. Lucide is the shadcn default; it fits the directive. Document the choice.
- **No print stylesheet.** Decklists are shared / printed. A `@media print` rules block would be cheap and on-brand.

**Verdict:** The macro visual language is well-defined and distinctive. The MTG-specific micro-language (mana, rarity, format, bracket, role, foil) is entirely missing, and several of these are needed in Phase 6 (collections) and Phase 7 (decks). This is the second largest gap behind component primitives.

---

## 7. Brand Alignment with Audience

**The audience is well-targeted.**

- "Serious MTG players — sealed-league enthusiasts, Commander brewers, draft players — who already know the game and want a thinking partner." That's a real, addressable, underserved persona. They are *not* the audience Moxfield/Archidekt/EDHrec/Manabox optimize for (each of those skews more general).
- The voice ("precise, knowledgeable, calm, generous, dry") *matches* the audience. Spikes and committed Commander brewers respond to confidence + receipts ("the rule of 18 lands + 8 ramp"), not hype.
- "Tables and lists are first-class" is the right call for this group. They read deck lists in plain text; they understand spreadsheet density.

**Direction C — Field Manual — works for the audience because:**

1. It signals *tool*, not marketplace. The audience is fatigued by buying-funnel UX.
2. It signals *competence*. Slab serif + technical line icons + tabular numbers say "I've thought about this."
3. It's distinctive without being precious. Direction A (Reading Room) risked dustiness; Direction B (Brutalist) risked coldness. C threads the needle.

**Risks to monitor:**

- **"Field Manual" could become brittle if it gets too literal.** Avoid bullet-list-everything UI, military-grade iconography, or "ops dashboard" data density. The brand cue is the *posture* of a manual, not the chrome.
- **Cream + green on the light theme can read as "vintage / golf course"** if executed without restraint. The slab serif helps; play with hierarchy density to keep it modern.
- **The audience knows their MTG vocabulary cold.** The brief enforces correct usage ("mana base, splash, payoff, enabler") — keep MTG-expert agent in the loop on every microcopy decision, especially error states and empty states.
- **Personality system (Spike/Brewer/Budget/Combo/Synergy) will need visual differentiation.** Each personality should feel like a different *voice* in the same calm tool — not five different brands.

**Verdict:** The brand and the audience are aligned to an unusual degree for a project of this size. The risk isn't strategic — it's execution drift over time. The mitigation is to keep the brief authoritative and update DECISIONS.md every time a screen forces a brand interpretation.

---

## 8. Recommendations Backlog (Brand & Design)

Ordered roughly by dependency (early items unblock later ones).

### 1. Fix the four sub-WCAG-AA token pairs

- **Why:** The brief's contract — "All paired tokens meet WCAG AA against their intended surface" — is not currently true. `fg-subtle` on `surface` (2.95x), `accent` on `surface` (4.10x for normal text), `warning` on `surface` (3.04x), and both `border` tokens (1.35x / 2.24x) fail. Either tune the colors or tighten the contract (e.g., document `border` as decorative and never information-bearing). Until this is resolved, every downstream component built on these tokens inherits the failure.
- **Phase/Priority:** Phase 1 polish / P0.
- **Effort:** S (half a day, including a contrast harness committed to the repo).

### 2. Build a contrast-verification harness (committed test)

- **Why:** A token contract that promises AA needs a test that proves it. A 50-line Node/Vitest test that imports the CSS variable definitions and asserts contrast ratios for every named pair would catch regressions forever and document the contract executably.
- **Phase/Priority:** Phase 1 polish / P0 (pair with #1).
- **Effort:** S.

### 3. Ship `branding/logo.svg` + favicon set

- **Why:** The agent charter lists the logo as a Phase 1 deliverable; it is missing. Without a logo + favicons, the app looks unfinished the moment it opens. Suggested cue: a slab-serif "T" treated as a bookmark / tab divider; or an open-book + magnifying-search composite (tutor-as-library-search). Generate at 16/32/180/192/512px + maskable.
- **Phase/Priority:** Phase 1 polish / P0.
- **Effort:** M (logo exploration + export + PWA manifest wiring).

### 4. Add a Scryfall attribution surface

- **Why:** The brief commits to "Credit Scryfall as the data source wherever card data appears." This becomes a blocker the moment card images render. Land a global footer attribution + a small per-card-image tooltip pattern + a policy line in `branding/brief.md`.
- **Phase/Priority:** Phase 1 polish / P0 (must be in place before Phase 6 collections view).
- **Effort:** S.

### 5. Self-host or font-load-strategy the three Google Fonts

- **Why:** `web/index.html` loads Inter, Roboto Slab, JetBrains Mono from `fonts.googleapis.com`. That's a third-party request on first paint, blocks offline-first dev, and ties brand identity to a service. Self-host with `@font-face` + `font-display: swap`, or document explicitly why we're OK with Google Fonts (privacy, GDPR, performance budget). Either is fine — but the decision needs to be made and logged.
- **Phase/Priority:** Phase 1 polish / P1.
- **Effort:** S.

### 6. Wire `:focus-visible` styles globally

- **Why:** Brief says "Focus rings: 2px solid `--color-accent`, 2px offset" — no implementation. Tailwind preflight removes default outlines. Right now, keyboard users see *nothing*. Add a base-layer `:focus-visible` rule in `tokens.css` or `index.css` that applies the documented ring.
- **Phase/Priority:** Phase 1 polish / P0.
- **Effort:** S.

### 7. Add WUBRG / mana / color-identity tokens + `<Mana>` component

- **Why:** Card-detail views (Phase 6+) need to render mana costs. The brief excludes Wizards' `{R}` symbol set on trademark grounds. Define `--color-mana-{w,u,b,r,g,c}` plus a small `<Mana cost="2RG" />` component that renders single-pip glyphs (custom SVG, shape + label, never color-only). Establish hybrid / phyrexian / X / variable patterns.
- **Phase/Priority:** Phase 6 (collection view) / P0.
- **Effort:** M (token design + SVG component + tests).

### 8. Add badge primitives: rarity, format, bracket, role, effect-tag

- **Why:** Each of these is a load-bearing visual signal in the product (rarity in gallery, format/bracket on deck, role/effect-tag on card detail). Each needs a *non-color-only* treatment per the a11y constraint. Suggest: rarity = stripe weight + letter glyph; format = filled vs outlined chip; bracket = numbered token; role = uppercase-mono chip; effect-tag = subtle-bg chip with icon.
- **Phase/Priority:** Phase 6–7 / P0.
- **Effort:** M.

### 9. Initialize shadcn/ui and generate canonical primitives

- **Why:** Committed in `DECISIONS.md`, not done. Run `pnpm dlx shadcn-ui@latest init` (configure the `cssVariables` mode so it consumes our existing tokens), then generate Button, Input, Label, Select, Dialog, Tabs, Tooltip, Toast, ScrollArea, DropdownMenu. Hand off to the engineer with a single reference page that demonstrates each in both themes.
- **Phase/Priority:** Phase 5 (before collections UI) / P0.
- **Effort:** M.

### 10. Wireframe the three load-bearing views before Phase 6 implementation

- **Why:** Collection grid, deck list, card detail are the product. Building them from prose is expensive; building them from a wireframe is cheap. Even tldraw / hand-sketches in `branding/wireframes/*.png` would unblock the engineer and give MTG-expert + PM something to react to.
- **Phase/Priority:** Phase 5–6 gate / P0.
- **Effort:** M (one focused day).

### 11. Build a `/_dev/tokens` and `/_dev/components` reference page

- **Why:** Without Storybook overhead, a `dev`-only route that renders every token swatch + every component variant in both themes is the single highest-leverage tool for keeping brand drift in check. Lock it behind a dev flag.
- **Phase/Priority:** Phase 5 / P1.
- **Effort:** M.

### 12. Add a z-index scale and named spacing aliases

- **Why:** Modals, popovers, drag overlays, sticky deck-row totals, tooltips will collide. Define `--z-modal`, `--z-popover`, `--z-overlay`, `--z-tooltip`. Add named spacing aliases for the two highest-traffic layouts (`--space-card-grid-gap`, `--space-deck-row-padding`).
- **Phase/Priority:** Phase 5 / P1.
- **Effort:** S.

### 13. Codify icon library choice (Lucide) + iconography do/don't

- **Why:** The brief specifies a style ("single-weight 1.5px line icons; technical-drawing posture"). Lucide fits and is shadcn's default. Document the choice in DECISIONS.md, install it, and write a one-paragraph do/don't (no emoji icons, no multi-color icons, no fantasy chrome). Define when to use shape-only vs icon-with-label.
- **Phase/Priority:** Phase 5 / P1.
- **Effort:** S.

### 14. Microcopy / strings library

- **Why:** Voice is documented but enforced only at review time. A `branding/copy/` directory with templates for error states, empty states, toast messages, and confirmation dialogs would let MTG-expert validate vocabulary in one pass. Pair with i18n preparation (even if V1 is English-only).
- **Phase/Priority:** Phase 6 / P1.
- **Effort:** M.

### 15. Print stylesheet for deck lists

- **Why:** Commander brewers print and share decklists constantly. A 60-line `@media print` block (mono font, no chrome, oracle text inline, bracket badge intact) is low-cost and brand-defining.
- **Phase/Priority:** Phase 7 / P2.
- **Effort:** S.

### 16. Personality visual language sketch

- **Why:** The Personalities feature (Spike/Brewer/Budget/Combo/Synergy) is roadmapped for V1.5. Each persona needs a visual signature — not a different brand, but a different *accent* (color hint, monogram, advice-card style). Sketching this in Phase 1 prevents painting into a corner later.
- **Phase/Priority:** Phase 1 polish (sketch only) / P2.
- **Effort:** M.

### 17. Empty / loading / error state component library

- **Why:** "Calm, knowledgeable companion" is most tested in failure modes. Generic "Something went wrong" copy violates voice. Define a small set of templates (empty collection, empty deck, no search results, Scryfall offline, sync stale) that the engineer can reach for.
- **Phase/Priority:** Phase 6 / P1.
- **Effort:** M.

### 18. Curve / role / pip chart styling guide

- **Why:** Visual-first is a product non-negotiable. The brief doesn't yet specify how charts look — axis font, gridline weight, color-vs-pattern policy, animation policy, hover affordances. Defer until V1.2 (when charts ship), but reserve a placeholder in the brief so the choice is made deliberately.
- **Phase/Priority:** V1.2 / P3 (placeholder now, full spec later).
- **Effort:** S (placeholder).

---

**End of audit.**
