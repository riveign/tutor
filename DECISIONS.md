# Decisions

A running log of every non-obvious choice. Each entry: date, decision, reason, alternatives considered, who decided.

## 2026-05-24 — Project name: **Tutor**

The MTG term "tutor" means searching your library for a card, which fits the effect-search and deckbuilding-companion metaphor exactly. User preference; final call by user.

Alternatives considered: *Mainboard* (clear MTG meaning, trademark-clean, brandable — strong runner-up), *Manabase* (too narrow), *Grimoire* (too fantasy-generic), *Cardstock* (sounds like a printing supplier), *The Eighth Land* (poetic but a mouthful).

## 2026-05-24 — V1 scope: data model + collections + decks + brand (no engine, no camera)

V1 ships:

- Brand identity (heavy focus, drives every screen)
- Full data model — all tables present, including KB / Personality / Bracket / EffectTag — schema is cheap to design once; backfilling later hurts
- Scryfall integration (live API + bulk-data sync + local image cache)
- Collections CRUD with acquisition tracking (pack/buy/trade + date + notes)
- Card entry: name search w/ autocomplete + set+collector-number + paste-list bulk import (no camera, no LLM tagging)
- Decks CRUD: name, format, bracket, add/remove, main/side, per-deck role field
- Card gallery + deck views, light/dark themes from brand tokens
- One-command local dev (`docker compose up`)

Post-V1 roadmap (sequenced): V1.1 effect-tag auto-derivation (rules-based) → V1.2 role/curve/pip charts → V1.3 KB seeding from web research → V1.4 deckbuilding engine that cites KB rules → V1.5 Personalities engaged → V2.0 camera capture + manual confirm → V2.1 camera identification → V2.2+ optional LLM tagging, multi-user/playgroup, mobile PWA polish.

## 2026-05-24 — Camera scanning dropped from V1

Highest-risk feature in the original brief. V1 must ship fully usable without it. Moved to V2.0+. Capture (V2.0) and identification (V2.1) are separable phases.

## 2026-05-24 — Backend = Rust (Axum + SQLx + Postgres)

User preference (no Vercel, no Node monolith).

- **Axum** — Tokio-native HTTP framework
- **SQLx** — async Postgres driver, compile-time-checked queries, built-in migrations (`sqlx migrate`)
- **serde / serde_json** — serialization
- **reqwest** — outbound HTTP for Scryfall
- **tracing** + **tracing-subscriber** — structured logging
- **utoipa** — OpenAPI schema generation from handlers
- **dotenvy** — env loading

Alternatives considered: Actix-web (heavier, less ergonomic), Rocket (slower release cadence), Diesel (sync, less ergonomic than SQLx for our queries), SeaORM (more abstraction than we need).

## 2026-05-24 — Frontend = plain React (Vite, no Next.js)

User preference (no Vercel framework lock-in).

- **Vite + React 18 + TypeScript**
- **React Router** (data router mode)
- **TanStack Query** — server state, caching, optimistic updates with rollback (per project CLAUDE.md pattern)
- **Tailwind + shadcn/ui**
- **react-hook-form + zod** — forms & validation
- **openapi-typescript** — generate typed FE client from the Rust-emitted OpenAPI spec; keeps the boundary type-safe without Next.js or a shared monorepo package
- **Vitest** + **Playwright** — tests

## 2026-05-24 — Rust ↔ React boundary = OpenAPI codegen

Rust handlers annotated with `utoipa` emit an OpenAPI 3 schema. The frontend runs `openapi-typescript` against it to produce a typed client. This replaces the typical Next.js "shared types via monorepo" trick. Costs one build step; pays for itself the first refactor.

## 2026-05-24 — Hosting deferred to Phase 7

Not chosen yet. Two candidates documented:

- **Option A (recommended)**: Fly.io for the Rust API + Fly Postgres, Cloudflare Pages for the static React build, Cloudflare R2 (S3-compatible, free egress) for the card-image cache. Lowest ops burden for a solo dev.
- **Option B**: Hetzner VPS + systemd + Caddy + self-hosted Postgres + R2 for images. Cheapest absolute $, more ops.

V1 dev does not depend on this choice — Docker-based local is the contract.

## 2026-05-24 — Project lives at `~/Development/mantis-dev/tutor/`

Sibling to other projects in `mantis-dev/`.

## 2026-05-24 — Brand direction: **C, Field Manual**

Cream paper + graphite + working-green/working-red palette; slab serif display (Roboto Slab) + Inter body + JetBrains Mono. Most distinctive of the three directions while still calm and tool-like.

Direction A (Reading Room) was closest to the *tutor = search the library* metaphor but risked reading as too quiet. Direction B (Modern Brutalist) was easiest to maintain at scale but its cold neutrality fought the "thinking partner" voice. Both were strong; C wins on distinctiveness without sacrificing voice.

Greens/reds/ambers are deliberately desaturated and shifted **outside** MTG's WUBRG palette so they don't collide with color-identity semantics in the UI. WUBRG itself will get dedicated `--color-mana-*` tokens when mana-cost widgets land.

## 2026-05-24 — Data model: single-user, oracle/printing split, m:n taxonomy with `source`

Phase 3 schema (migrations 0002–0005). Core decisions:

- **Single-user / no auth in V1.** Schema has no `owner_id` columns. When multi-user lands, add `owner_id uuid REFERENCES users(id)` and partial unique indexes per owner.
- **Oracle vs printing split.** `cards` is keyed by Scryfall `oracle_id` (one row per unique gameplay card); `printings` is keyed by Scryfall `card.id` (one row per physical printing). Collections track printings (you own a specific printing); decks track oracle cards (the gameplay-relevant identity) and *optionally* lock a `printing_id` when a physical copy is reserved.
- **Faces table.** `card_faces` holds per-face data for DFC/transform/split/adventure cards; single-face cards have one row.
- **Tagging with `source` in the primary key.** `card_effect_tags` and `card_functional_roles` are m:n joins keyed by `(oracle_id, tag_id, source)`. A rule-based tagger, a manual override, and community data can all coexist independently. Each assertion carries an optional `confidence` (0..1) and free-form `notes`.
- **`pg_trgm` for name/type search**, GIN on text-array columns (`color_identity`, `colors`, `keywords`, `produced_mana`). Avoids needing a separate search engine for V1.
- **`set_updated_at()` trigger function** attached to every row-mutable table — keeps `updated_at` honest without app-layer code.
- **Tutor-derived flags on cards**: `affects_board_on_cast` and `fetchable_land_types`. Populated by our analyzer (Phase 6), not by Scryfall.

## 2026-05-24 — Phase 8b: collection browse extends `/cards/search`, doesn't fork it

Browsing a single collection ("show me only what I own in this pile, with the same filters as the global catalog") could live behind a new endpoint, but the Phase 5 search shape — filters, pagination, response envelope — is exactly the shape the UI needs scoped. Extending the existing handler with two optional query params (`collection_id`, `grouping`) and additive optional fields on `CardSummary` (`owned_quantity`, `printing_id`, `set_code`, `collector_number`, `finish`, `language`, `condition`) keeps both surfaces a single contract and lets the frontend reuse one component for both.

Rejected alternative: a new `GET /collections/{id}/browse` mirror. That would duplicate the filter parser, the pagination clamps, the OpenAPI annotations, and force the React side to maintain two near-identical hooks. The additive-extension cost is one extra SQL subquery for the `owned_quantity` rollup and one branch for the printing-grouped path.

On the FE, `BrowsePage` (the global `/cards` UI) was reduced to a thin wrapper and a new reusable `<CardBrowser />` component owns the form + result table. `CollectionDetail` mounts a two-tab control (`Entries | Browse`) — local React state, not URL-driven, so filter state stays scoped to the tab. The Browse tab has an `Oracle | Printing` radio toggle for grouping. Cache key for the scoped browse is `["collections", id, "browse", { ...filters, grouping, page }]`; the existing add/patch/delete mutations were updated to invalidate by `["collections", id, "browse"]` prefix.

## 2026-05-24 — Phase 8d: collector-# add mode + latest-nonfoil default + inline picker

Three feedback-driven changes to the Phase 8c split-pane add flow:

1. **Latest-nonfoil default printing.** `pickDefaultPrinting` (in `web/src/lib/cardDefaults.ts`) replaces the previous "whatever the server returned first" pick. Rule: order printings by `released_at DESC`, prefer those whose `finishes` include `nonfoil`, fall back to newest-of-any-finish if zero qualify. The PRINTING dropdown still lists every printing — this only changes the auto-selection.
2. **Inline picker results.** `CardPicker` no longer renders its result list as an absolutely-positioned popover. Results live INLINE in a vertical flex column that fills the parent's slot, so the left half of the split pane is never visually empty. Public API (`onHighlight`, `onSelect`, `autoFocus`, `placeholder`, `ref.focus()`) is unchanged.
3. **Collector-# add mode.** A new mode toggle (Name · Collector #) lives at the top of the left pane (`AddCardLeftPane`). The collector-# flow is set-picker → number input → Enter to look up. On a unique hit the highlight emits with a `collector_number_filter` field on `CardPickerHighlight` so the preview defaults to that exact printing. On a miss, the input gets a red border + inline error + "Or search by name →" fallback that flips the mode toggle. After a successful add the number clears + refocuses; the SET persists, enabling rip-a-pack flows (`123 ↵ Tab ↵ 124 ↵ Tab ↵ …`).

Backend additions (additive, no breaking changes):

* `GET /sets` gained `q` (substring on `code` OR `name`, ILIKE) and `limit` (clamped 1..500, default 50) so the set-picker autocomplete can avoid paginating the full catalog client-side.
* `GET /cards/search` gained `collector_number` (composes with `set_code` inside the existing `EXISTS (printings)` subquery; case-insensitive match on `lower(p.collector_number)` so star promos and a/b suffixes match cleanly).

Rejected alternatives: a separate `GET /cards/lookup?set=&cn=` endpoint (would duplicate the filter machinery); separate `GET /sets/search` route (the existing `/sets` already lists everything — adding a query param is the smaller diff). The collector-# mode lives in its own component (`CollectorNumberPicker` + `SetPicker`) instead of bolting branches onto `CardPicker`, because the keyboard/state model is sufficiently different (no global typeahead, two inputs in sequence, success-resets the number but not the set).

## 2026-05-24 — Four collaborating agents

`tutor-pm`, `tutor-engineer`, `tutor-mtg-expert`, `tutor-brand-design`. Defined in `.claude/agents/`. The orchestrating Claude routes phases; each agent has a tight charter (see their definitions). Plan → approval → implement → verify, at every phase.

## 2026-05-24 — Phase 6: Collections CRUD + entries with provenance (`4a040f0`)

Phase 6 shipped. Collections are first-class: create / rename / delete a named pile, add and remove individual printings, track per-entry `quantity`, `finish`, `language`, `condition`, plus acquisition provenance (`acquired_at`, `acquired_from`, free-form `notes`). Entries are keyed by `printing_id` (Scryfall `card.id`), not by oracle — you own a *specific printing*, not an abstract gameplay card. Patch + delete are optimistic with rollback on the FE per the project React patterns.

## 2026-05-24 — Phase 7: Decks CRUD + entries with zones (`be30bd3`)

Decks shipped with `name`, `format`, zones (`main` / `side`), and per-entry quantity. Deck entries reference `oracle_id` (gameplay identity), with an optional `printing_id` reservation when the user pins a specific physical copy. `bracket_id` and per-deck role field are present in the schema (Phase 3) but UI-deferred until BL-43 / BL-46 land (bracket model) and the functional-role taxonomy ships (BL-45).

## 2026-05-24 — Phase 8a: card picker autocomplete (`666dd7d`)

Replaced raw printing-UUID input on the collections add form with a typeahead combobox over `/cards/search`: 200 ms debounce, capped 20 results, keyboard nav, inline `set:XXX` token (parsed client-side, API surface unchanged). Two-stage chooser surfaces when an oracle has multiple printings; auto-resolves to the unique match when filtered. Smart defaults on selection (qty 1, nonfoil if printed, en, near_mint). After-submit refocus enables rip-the-pack add cadence.

## 2026-05-24 — Phase 8b: collection browse extends `/cards/search`, doesn't fork it

Browsing a single collection ("show me only what I own in this pile, with the same filters as the global catalog") could live behind a new endpoint, but the Phase 5 search shape — filters, pagination, response envelope — is exactly the shape the UI needs scoped. Extending the existing handler with two optional query params (`collection_id`, `grouping`) and additive optional fields on `CardSummary` (`owned_quantity`, `printing_id`, `set_code`, `collector_number`, `finish`, `language`, `condition`) keeps both surfaces a single contract and lets the frontend reuse one component for both.

Rejected alternative: a new `GET /collections/{id}/browse` mirror. That would duplicate the filter parser, the pagination clamps, the OpenAPI annotations, and force the React side to maintain two near-identical hooks. The additive-extension cost is one extra SQL subquery for the `owned_quantity` rollup and one branch for the printing-grouped path.

On the FE, `BrowsePage` (the global `/cards` UI) was reduced to a thin wrapper and a new reusable `<CardBrowser />` component owns the form + result table. `CollectionDetail` mounts a two-tab control (`Entries | Browse`) — local React state, not URL-driven, so filter state stays scoped to the tab. The Browse tab has an `Oracle | Printing` radio toggle for grouping. Cache key for the scoped browse is `["collections", id, "browse", { ...filters, grouping, page }]`; the existing add/patch/delete mutations were updated to invalidate by `["collections", id, "browse"]` prefix.

## 2026-05-24 — Phase 8c: split-pane CardPicker + CardPreview (`2310a60`)

Replaced the linear "search → form" UX with a persistent split-pane: left half is the picker, right half is a live `CardPreview` that paints as soon as a row is highlighted. The two share the picker's detail query key, so the image is already in cache by the time the user lands on a card. After Confirm the picker selection persists; only form fields reset, a brief "Added" flash plays, and the picker is refocused so the user can type or arrow to the next card immediately. CardPicker gained an `onHighlight` callback (debounced 80 ms) and made `onSelect` optional so legacy callers — which use the two-stage oracle → printing chooser — keep working without changes.

## 2026-05-24 — Phase 8d: collector-# add mode + latest-nonfoil default + inline picker

Three feedback-driven changes to the Phase 8c split-pane add flow:

1. **Latest-nonfoil default printing.** `pickDefaultPrinting` (in `web/src/lib/cardDefaults.ts`) replaces the previous "whatever the server returned first" pick. Rule: order printings by `released_at DESC`, prefer those whose `finishes` include `nonfoil`, fall back to newest-of-any-finish if zero qualify. The PRINTING dropdown still lists every printing — this only changes the auto-selection.
2. **Inline picker results.** `CardPicker` no longer renders its result list as an absolutely-positioned popover. Results live INLINE in a vertical flex column that fills the parent's slot, so the left half of the split pane is never visually empty. Public API (`onHighlight`, `onSelect`, `autoFocus`, `placeholder`, `ref.focus()`) is unchanged.
3. **Collector-# add mode.** A new mode toggle (Name · Collector #) lives at the top of the left pane (`AddCardLeftPane`). The collector-# flow is set-picker → number input → Enter to look up. On a unique hit the highlight emits with a `collector_number_filter` field on `CardPickerHighlight` so the preview defaults to that exact printing. On a miss, the input gets a red border + inline error + "Or search by name →" fallback that flips the mode toggle. After a successful add the number clears + refocuses; the SET persists, enabling rip-a-pack flows (`123 ↵ Tab ↵ 124 ↵ Tab ↵ …`).

Backend additions (additive, no breaking changes):

* `GET /sets` gained `q` (substring on `code` OR `name`, ILIKE) and `limit` (clamped 1..500, default 50) so the set-picker autocomplete can avoid paginating the full catalog client-side.
* `GET /cards/search` gained `collector_number` (composes with `set_code` inside the existing `EXISTS (printings)` subquery; case-insensitive match on `lower(p.collector_number)` so star promos and a/b suffixes match cleanly).

Rejected alternatives: a separate `GET /cards/lookup?set=&cn=` endpoint (would duplicate the filter machinery); separate `GET /sets/search` route (the existing `/sets` already lists everything — adding a query param is the smaller diff). The collector-# mode lives in its own component (`CollectorNumberPicker` + `SetPicker`) instead of bolting branches onto `CardPicker`, because the keyboard/state model is sufficiently different (no global typeahead, two inputs in sequence, success-resets the number but not the set).

## 2026-05-24 — Phase 8e–8i: Add Card flow polish

Iterative polish on the split-pane add flow:

- **8e (`e6fbb77`)** — Fixed a TDZ crash in the collector-# branch (referenced state before its declaration) and reflowed `CardPreview` into a two-column layout (image left, metadata + form right) so the right pane reads naturally.
- **8f (`6c9269a`)** — Add Card pane visual repair: label spacing, empty-state copy, mode-aware helper text per branch (name vs collector #).
- **8g (`7b9a849`)** — Collector # inline add row. Replaces the staged set→# layout with a single inline row (`SET • #N • Add`) for true rip-the-pack cadence.
- **8h (`ec021dc`)** — Long set names in the PRINTING `<select>` would overflow the dropdown column on long product names; now CSS-truncated with the full name in the `title` attribute.
- **8i (`3f62de0`)** — Dropped `finish` and `condition` from the Add Card UI entirely. They remain in the API and schema but default silently (nonfoil + near_mint). The form now optimises for the gameplay loop ("which card, how many"), not the grader's loop. See the new product-direction decision below.

## 2026-05-24 — Defer collector-grade tracking; focus on gameplay + deckbuilding

Product-direction call. The original V1 scope included per-entry `finish` and `condition` because acquisition provenance was a load-bearing requirement. Real use revealed that the user is a player first and a grader second: typing finish and condition on every add was the slowest gate in the rip-the-pack flow, and the data was almost never queried afterward. Hiding those controls cut add time roughly in half and re-framed Tutor as a *deckbuilding companion* rather than a collection-quality ledger.

The schema columns are retained on `collection_entries` — re-introducing per-entry finish/condition is a pure UI change later if the user wants it back, no migration. Default values sent silently are `finish=nonfoil`, `condition=near_mint`. This pivots subsequent V1 phases away from collection-quality enrichment and toward deck-building polish (Phase 9 candidates below).

## 2026-05-24 — Phase 8j: CI fixes — rustfmt drift (`7d387d7`) + Postgres service (`7de11a4`)

Two CI hygiene fixes that surfaced once Phase 8 churn settled:

- `cargo fmt --check` was failing on `decks` route + `collection / decks / sets` tests. Re-ran `cargo fmt` and committed the diff. No behavior change.
- The Rust CI job had no `services: postgres` block, so every `#[sqlx::test]` was silently being skipped. Added a Postgres 16 service container with `DATABASE_URL` wired through. Closes BL-05.
