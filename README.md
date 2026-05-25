# Tutor

The ultimate collection manager and deckbuilding companion for Magic: The Gathering players.

## Status

Phase 8 shipped. Collections + decks CRUD, card-browse, and a focused gameplay-first Add Card flow (split-pane picker + preview, collector-# rip-the-pack mode, smart defaults) are on `main`. CI runs Rust + SQLx integration tests against a real Postgres service. Next up is Phase 9a — applying the same Add Card UX patterns to the deck-entry flow. See [`ROADMAP.md`](./ROADMAP.md) for the phase ledger and [`DECISIONS.md`](./DECISIONS.md) for the decision log.

## Core ideas (the differentiators)

- **Multiple physical collections** with provenance — when and how each card entered.
- **Effect/role-based search** — beyond color and type, classify cards by what they *do* in a deck.
- **Knowledge-base-as-data deckbuilding** — archetype templates, role-ratio guidelines, mana-base rules; the deckbuilder cites which rules it used.
- **Personalities** — selectable advisor profiles (Spike, Brewer, Budget, Combo, Synergy) bias recommendations.
- **Local-first**, with a clean path to production.

## Stack

- **Backend:** Rust 1.78+, Axum 0.7, SQLx 0.8 (Postgres, compile-time-checked, embedded migrations), utoipa (OpenAPI), tokio, tracing.
- **Frontend:** Vite + React 18 + TypeScript (strict), TanStack Query, React Router, Tailwind, design tokens from [`branding/tokens.css`](./branding/tokens.css). The TS client is generated from the API's OpenAPI document.
- **Infra:** Docker Compose for Postgres only; API + Web run on the host via `make`.

## Quick start

Requires: Rust toolchain, Node 20+, pnpm 9, Docker.

```bash
cp .env.example .env
make bootstrap         # installs web deps
make dev               # postgres + api + web, all in one terminal
```

Then:

- API: http://localhost:8080
- API docs (Swagger UI): http://localhost:8080/docs
- OpenAPI JSON: http://localhost:8080/openapi.json
- Web: http://localhost:5173
- Postgres: localhost:55432 (mapped from the container's 5432 so it doesn't clash with a system Postgres)

`make help` lists every target. Common ones:

| Target            | What it does                                         |
| ----------------- | ---------------------------------------------------- |
| `make db-up`      | Start Postgres in Docker                             |
| `make api`        | Run the Rust API (migrations apply on boot)          |
| `make web`        | Run the Vite dev server                              |
| `make codegen`    | Regenerate `web/src/lib/api/schema.ts` from OpenAPI  |
| `make test`       | `cargo test` + `vitest run`                          |
| `make lint`       | `cargo clippy -D warnings` + `eslint`                |
| `make typecheck`  | `tsc --noEmit` for the web app                       |
| `make db-reset`   | Wipe and recreate the Postgres volume                |
| `make ingest-all` | Sync sets, oracle cards, and printings from Scryfall |

### Ingesting the Scryfall catalog

The catalog (sets, oracle cards, printings) is populated by `tutor-ingest`, a
CLI that lives alongside the API binary. Bulk JSON files are cached at
`$TUTOR_DATA_DIR` (default `data/scryfall/`) and only re-downloaded when
Scryfall reports a newer `updated_at`.

```bash
make ingest-sets        # /sets endpoint, ~1s
make ingest-cards       # ~30k oracle cards, ~1-2 min
make ingest-printings   # ~500k printings, ~5-10 min
make ingest-all         # sets, then cards, then printings
```

After ingest, `GET /api/health` reports row counts under `data.{sets,cards,printings}`.
Pass `--refresh` to the underlying binary to force re-download:

```bash
cd api && cargo run --bin tutor-ingest -- cards --refresh
```

The client respects Scryfall's etiquette (50-100 ms gap between requests,
identifying User-Agent, retries on 429).

### Vite + inotify on Linux

If `pnpm dev` fails with `Error: EMFILE: too many open files, watch`, raise the kernel's inotify limits:

```bash
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/40-inotify.conf
echo 'fs.inotify.max_user_instances=512'  | sudo tee -a /etc/sysctl.d/40-inotify.conf
sudo sysctl --system
```

## Working with the project

The project uses four collaborating Claude Code agents in [`.claude/agents/`](./.claude/agents/):

- **tutor-pm** — roadmap, phase plans, scope, `DECISIONS.md`.
- **tutor-engineer** — Rust (Axum/SQLx) backend, plain React (Vite/TS/Tailwind/shadcn) frontend, Postgres, Docker, CI.
- **tutor-mtg-expert** — effect-tag and functional-role taxonomies, WotC bracket rules, deckbuilding philosophy seed content.
- **tutor-brand-design** — voice, palette, typography, logo, design tokens, UI patterns, accessibility.

Each phase runs: short plan → user approval → implement → verify.

## Trademarks

Tutor is an independent project, MTG-adjacent and legally distinct. No Wizards of the Coast trademarks, color-pip symbols, or card frames are used. Card data and images come from [Scryfall](https://scryfall.com) under Scryfall's terms.
