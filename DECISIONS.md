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

## 2026-05-24 — Four collaborating agents

`tutor-pm`, `tutor-engineer`, `tutor-mtg-expert`, `tutor-brand-design`. Defined in `.claude/agents/`. The orchestrating Claude routes phases; each agent has a tight charter (see their definitions). Plan → approval → implement → verify, at every phase.
