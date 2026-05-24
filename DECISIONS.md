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

## 2026-05-24 — Four collaborating agents

`tutor-pm`, `tutor-engineer`, `tutor-mtg-expert`, `tutor-brand-design`. Defined in `.claude/agents/`. The orchestrating Claude routes phases; each agent has a tight charter (see their definitions). Plan → approval → implement → verify, at every phase.
