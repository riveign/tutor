# Tutor — Engineering Stack Audit

> Read-only audit performed 2026-05-24. Scope: repo structure, backend (Rust/Axum/SQLx), schema, frontend (React/Vite/TS), API contract, Docker dev loop, tests, CI, deps, tech debt. Domain/MTG-taxonomy, brand visuals, and PM roadmap are out of scope (covered by parallel audits). Working branch at audit time: `phase-5-card-browse` with uncommitted Phase 5 work in progress.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Repo Structure](#1-repo-structure)
3. [Backend (Rust / Axum / SQLx)](#2-backend-rust--axum--sqlx)
4. [Schema & Migrations](#3-schema--migrations)
5. [Frontend (React / Vite / TS)](#4-frontend-react--vite--ts)
6. [API Contract (OpenAPI / Rust ↔ TS)](#5-api-contract-openapi--rust--ts)
7. [Docker Dev Loop](#6-docker-dev-loop)
8. [Tests](#7-tests)
9. [CI/CD](#8-cicd)
10. [Dependencies](#9-dependencies)
11. [Tech Debt & Risk](#10-tech-debt--risk)
12. [Recommendations Backlog (Engineering)](#11-recommendations-backlog-engineering)

---

## Executive Summary

The codebase through Phases 1–4 is genuinely good for its age (six commits). It is small, intentional, and the agent operating doctrine in `DECISIONS.md` is being honoured: stack choices are documented with alternatives; the oracle/printing split is correct; the Scryfall etiquette gate is real; the per-row `updated_at` trigger removes a whole class of bugs. The Phase 5 card-browse work-in-progress (currently on branch `phase-5-card-browse`) also shows the OpenAPI → TS codegen loop working end-to-end: the generated `schema.ts` is now sourced by the hand-written `client.ts`.

Below the surface, however, the project is one bad merge away from a quiet rot. **The stack contract promises compile-time-checked SQL via `sqlx::query!` macros; the implementation uses zero of them.** Every query is the runtime `sqlx::query()` form, so the compiler can never tell us a column was renamed in a migration, a binding type drifted, or a JSON shape changed. `SQLX_OFFLINE=true` is also set in CI as a placeholder, but there is no `.sqlx/` cache — it is dormant. Combined with the lack of a `cargo deny` / dependency-audit job, the safety story is weaker than the stack notes imply.

A few more themes:

- **Tests stop at the data layer.** The ingest fixtures + Phase 5 handler tests exercise migrations, triggers, and JOINs — good. There is no Axum-router test (full HTTP path), no Playwright/e2e, and the FE has exactly one rendering test for the health probe. As the surface grows (Phase 5+ collections, decks, KB), this gap will dominate bug volume.
- **Errors silently degrade.** `ApiError::Database` and `ApiError::Other` both return the literal string `"internal error"` without a `request_id`, error code, or structured payload. Hard to debug, hard for the FE to react to specific cases (the project CLAUDE.md "failures first" / "always re-raise" principle is honoured for *propagation* but not for *exposure*).
- **No request-scoped state.** No `request_id` middleware, no CORS layer (will bite the moment FE and API are on different origins), no body-size limits, no timeout middleware. All easy to add now, painful later.
- **Schema is solid but missing one thing.** No `schema_version` row, no `pg_stat_statements` enablement, no full-text-search column on `cards` (we have `pg_trgm` GINs only) — fine for V1 search, but the absence of a `search_tsv` will hurt the moment "weighted name + oracle_text" search is wanted.
- **Frontend is empty.** shadcn/ui is in the stack contract but not installed; `react-hook-form` + `zod` likewise; no error-boundary; the design tokens are wired through Tailwind theme correctly, but there are no real components yet.

### Top findings (severity-ordered)

1. **No compile-time-checked queries** despite the stack promise — the safety net is theoretical.
2. **No Axum-level integration test or e2e test** — handler unit tests bypass routing and middleware entirely.
3. **`ApiError` leaks no actionable shape to the client** — every server error is an opaque "internal error".
4. **No CORS / request-id / timeouts / body-size middleware** — minimum viable Axum hardening absent.
5. **CI runs `SQLX_OFFLINE=true` with no `.sqlx/` cache** — currently a no-op, becomes a CI break the day someone adopts `query!`.

### Top recommendations

| # | Title | Phase | Priority | Risk |
|---|-------|-------|----------|------|
| R1 | Adopt `sqlx::query!`/`query_as!` macros and check in `.sqlx/` offline cache | Phase 5 | P0 | low |
| R2 | Structured `ApiError` payload (code, message, request_id) + 4xx variants | Phase 5 | P0 | low |
| R3 | Add Axum hardening middleware: CORS, request-id, timeouts, body-size, compression | Phase 5 | P0 | low |
| R4 | Add Axum-level HTTP integration tests (real `Router`, real `oneshot`) | Phase 5 | P1 | low |
| R5 | Install shadcn/ui + react-hook-form + zod scaffolding before Phase 6 UI work | Phase 5 / 6 | P1 | low |
| R6 | Add `cargo deny` + `cargo audit` job and `pnpm audit` job to CI | Phase 5 | P1 | low |
| R7 | Introduce Playwright with one smoke test (health probe) wired to docker-compose | Phase 6 | P1 | low |
| R8 | Add `schema_version` row + `pg_stat_statements` extension; document migration policy | Phase 5 | P2 | low |
| R9 | Replace `BASE = "/api"` in `client.ts` with an `openapi-fetch` client; drop hand-written URL plumbing | Phase 5 | P2 | low |
| R10 | Per-route OpenAPI error responses (`responses(... 400, 404, 500)`) wired to the new `ApiError` shape | Phase 5 | P2 | low |

### Next Steps

- Confirm with PM that Phase 5 will absorb R1–R3 + R6 as foundation tasks before card-browse UI work continues.
- Schedule R4 + R5 + R10 as part of Phase 5 acceptance.
- Defer R7–R9 to Phase 6 entry criteria. Everything else (Phase 7+) becomes part of the hardening pass before the first deploy.

---

## 1. Repo Structure

```
tutor/
├─ api/                 Rust workspace member: tutor-api lib + bin + tutor-ingest bin
│  ├─ src/{db,error,lib,main,openapi,routes,scryfall}…
│  ├─ migrations/       sqlx-managed SQL (0001…0005)
│  └─ tests/            ingest_fixtures.rs + Phase 5 cards_browse.rs (uncommitted)
├─ web/                 plain Vite + React 18 app
│  ├─ src/{App,main,router,index.css,lib/api/{client,schema}}
│  └─ tailwind.config.ts pulls tokens from branding/tokens.css via :root vars
├─ branding/            tokens.css + brief.md (Phase 1 deliverable)
├─ .github/workflows/ci.yml   single workflow, two jobs (rust, web)
├─ docker-compose.yml   Postgres only — API + Web run on the host
├─ Makefile             single source of truth for `make dev`
└─ DECISIONS.md         non-obvious choices, with alternatives considered
```

### What works

- **Cargo workspace with a single `api` member** is the right call. It leaves room for `tutor-tagger`, `tutor-kb`, etc. as new crates without rewriting layout.
- **`tutor-api` is both lib and bin.** The lib (`src/lib.rs`) exports `build_router(state)` and `serve()`, which makes integration tests trivially possible — the missing tests (see §7) are an *adoption* gap, not a structural one. The `tutor-ingest` bin reuses the same lib's `scryfall` module instead of duplicating models — clean.
- **Frontend `lib/api/` is correctly split** into `schema.ts` (generated, eslint-ignored) and `client.ts` (hand-rolled fetcher that re-exports types from the schema).
- **One Makefile** is doing the orchestrator job. No nested `package.json` scripts that drift, no `justfile` competing.

### Smells

- **No `crates/` subdirectory.** Workspace currently lists one member at `api/`. Fine for now, but when the second crate lands (almost certainly `tutor-tagger` or a shared `tutor-domain`), the path-level `members = ["api"]` becomes awkward without a `crates/` parent. Cheap to leave alone; cheap to refactor later. Not a blocker.
- **`api/data/scryfall/` is created at runtime under `api/`.** Properly gitignored (`**/data/scryfall/`, `**/data/images/`). However, this couples bulk-cache location to the cargo workspace root, which means a future containerised API can't easily mount a separate volume without overriding `TUTOR_DATA_DIR`. Trivial to override (already supported via env), but worth a note in DECISIONS.md.
- **`outputs/` and `tmp/` are not in `.gitignore`** (they exist in the working tree and `git status` shows them as untracked). Fine while they're scratch dirs for mux/Claude orchestration, but if any of these ever contain user data they'll trip `git add .` accidents.

---

## 2. Backend (Rust / Axum / SQLx)

### Strengths

- **Clean module split.** `db.rs` (pool setup + `migrate!`), `error.rs` (`ApiError` + `IntoResponse`), `openapi.rs` (single `ApiDoc`), `routes/` (per-resource), `scryfall/{client,import,models}`. Files are short (most under 200 lines).
- **`AppState` is a simple `Clone` wrapper around `PgPool`** — exactly what Axum wants. No service-locator pattern, no leaky abstractions.
- **`build_router(state)` returns the fully-wired `Router`** with Swagger UI and `TraceLayer` already applied, before `serve()` binds the listener. This is the right shape for integration tests — handlers can be exercised via `tower::ServiceExt::oneshot` against a real `Router`.
- **Scryfall client is correct.** A shared `Arc<Mutex<Instant>>` rate-limit gate, 120ms minimum gap (above Scryfall's 50–100ms recommendation), exponential backoff on 429, and identifying `User-Agent`. The bulk-download path streams to disk via `bytes_stream()` — does not buffer the whole ~150MB `default_cards.json` in memory.
- **`ScryfallCard::resolved_oracle_id()` and `resolved_type_line()`** correctly handle the reversible-card edge case where `oracle_id` lives on the face rather than the top-level object. This is the kind of small win that prevents data corruption on multi-faced cards.
- **`#[from] sqlx::Error` on `ApiError::Database`** + the matching `#[from] anyhow::Error` on `ApiError::Other` give clean `?`-propagation. No `unwrap()` in production code paths (the one `expect("static progress template")` in `ingest.rs` is on a hard-coded `indicatif` template — acceptable, but flag-able).

### Issues

1. **No `sqlx::query!` macros anywhere.** Every query in `routes/cards.rs`, `routes/health.rs`, `routes/sets.rs`, and the entire `scryfall/import.rs` is `sqlx::query(...)` or `sqlx::query_scalar(...)` — runtime SQL. The stack contract (in DECISIONS.md and the agent prompt) says "compile-time-checked queries". CI even sets `SQLX_OFFLINE: "true"` — but with no `.sqlx/` cache and zero macro use, the flag is currently a no-op. The whole reason to choose SQLx over Diesel was compile-time checking; right now you have neither. This is the single highest-leverage technical risk to address before Phase 5 grows.

2. **Error shape is opaque.** `ApiError::Database(e)` and `ApiError::Other(e)` both log the real error and return `{"error": "internal error"}` with `500 INTERNAL_SERVER_ERROR`. From the client's perspective every server fault is identical. There is no `request_id`, no machine-readable `code`, no 4xx variants other than `NotFound`. Phase 5+ (forms, deck mutations, optimistic updates) will need:
   - `BadRequest { code, message, field_errors }` for zod-equivalent validation feedback
   - `Conflict` for unique-constraint violations (e.g. duplicate `(collection_id, printing_id, finish, language, condition)`)
   - `UnprocessableEntity` for business-rule violations (e.g. deck commander color identity mismatch)
   - A `request_id` echoed in headers and the response body so the FE can show "show details" with a copy-paste identifier matching the server log.

3. **No middleware beyond `TraceLayer`.** Missing minimum viable hardening, per `tower-http`:
   - **No CORS layer.** Vite proxies `/api` to `:8080` in dev so CORS is silent now, but the moment FE is deployed on Cloudflare Pages and API on Fly.io (per DECISIONS.md Phase 7), the API will reject browser requests. `CorsLayer::new().allow_origin(...)` is one line.
   - **No `RequestIdLayer` / `PropagateRequestIdLayer`.** Required for the error shape above to work.
   - **No `TimeoutLayer`.** A single slow Postgres query will hold a Tokio task forever.
   - **No `RequestBodyLimitLayer`.** Mutating endpoints (Phase 5+) will accept arbitrarily large bodies.
   - **No `CompressionLayer`.** `tower-http` is already pulled in with the `compression-gzip` feature in `Cargo.toml` — currently unused.

4. **`AppState` carries only `PgPool`.** That's fine now, but the moment Scryfall live-search lookups (single card by name) or image-cache backfills hit the API, `ScryfallClient` will need to be in the state too (to share the rate-limit gate across handlers). Worth designing the next state expansion now.

5. **`main.rs` config is minimal.** No `axum::extract::FromRef` for sub-state, no `Config` struct, no validation that required env vars are present at startup. `DATABASE_URL` is read directly with a `map_err`; `API_BIND` defaults silently. A small `Config` struct with `clap::Parser` (already a dep — used by `tutor-ingest`) would centralise this.

6. **`OpenAPI` schemas miss the `legalities` / `image_uris` jsonb shape.** Both serialize as `unknown` in the generated `schema.ts` because the Rust types are `serde_json::Value`. The TS client gets no help finding `legalities["commander"]`. Either (a) define `Legalities { commander: Option<String>, modern: Option<String>, … }` and serialize as a fixed struct, or (b) document the shape via `#[schema(value_type = ...)]` annotations. (a) is preferable: the legalities format is stable and small.

### Smaller notes

- `routes/cards.rs::search_cards` builds the count query and the items query separately, both via `QueryBuilder`. Two trips for paginated search is fine; switch to a single `SELECT ... FROM cards c ..., (SELECT count(*) ... ) total LIMIT ...` only if profiling shows it.
- `routes/cards.rs::push_filters` uses `WHERE 1=1` so each filter can prepend ` AND ...`. Pragmatic and readable. Watch for SQL injection — every user-supplied value goes through `push_bind`, so this is safe.
- `db::connect` uses `max_connections = 10` and a 5s acquire timeout. Reasonable for V1; revisit when ingest + API run simultaneously (ingest itself uses 8 conns from a separate pool — fine since each binary has its own pool).
- The migration applies on every boot (`db::migrate(&pool).await?`). That's correct for single-tenant dev; for prod you'll want a `--migrate-only` flag and a release gate that runs it once. Phase 7 issue, not now.

---

## 3. Schema & Migrations

### Strengths

- **Real PostgreSQL, real schema.** No EAV, no JSONB-as-table, no auto-incrementing surrogates everywhere — `cards` is keyed by Scryfall `oracle_id`, `printings` by Scryfall `id`, `sets` by `code`. That alignment with the upstream identifier system is exactly right; it makes upserts trivial and re-ingest idempotent.
- **`pg_trgm` GIN indexes on `name` and `type_line`** + GIN on the text-array columns (`color_identity`, `colors`, `keywords`, `produced_mana`). Sufficient for V1 search without a separate engine.
- **The `set_updated_at()` trigger** is attached to every row-mutable table (`sets`, `cards`, `printings`, `card_faces` is the only omission — likely intentional since faces are wiped+reinserted by the ingester). Keeps `updated_at` honest without app-layer code, which means an external SQL update or a `psql` correction won't desync timestamps.
- **`card_effect_tags` / `card_functional_roles`** use `(oracle_id, tag_id, source)` as the composite PK with `tagging_source` enum and an optional `confidence` real CHECK-constrained to [0..1]. The fact that a manual tag and a rule-based tag can coexist is the right call — and the tagging engine in Phase 6 can write without clobbering user overrides.
- **FK actions are deliberate.** `printings.set_code REFERENCES sets(code) ON DELETE RESTRICT` (sets don't disappear), `deck_entries.printing_id ... ON DELETE SET NULL` (printing being removed shouldn't break the brewed list), `collection_entries.printing_id ... ON DELETE RESTRICT` (cannot delete a printing while a physical copy exists). Each direction is correct.
- **Enums where appropriate** (`card_finish`, `card_condition`, `deck_zone`, `tagging_source`). Free-form `text` columns where the universe is open (deck `format`, collection `kind`, deck `archetype`).
- **`UNIQUE (collection_id, printing_id, finish, language, condition)`** on `collection_entries` correctly collapses identical physical copies into one row with a quantity.
- **Migrations are forward-only and short.** `0002` introduces extensions + the helper function; `0003`–`0005` introduce real tables. No "down" scripts — fine for forward-only sqlx style.

### Issues

1. **No `search_tsv` column on `cards`.** `pg_trgm` is great for fuzzy substring on `name`, but Phase 6 ("search by what a card *does*") will want weighted FTS across `name`, `type_line`, `oracle_text`, `keywords`. A `search_tsv tsvector GENERATED ALWAYS AS (...) STORED` + GIN index is the standard pattern. Add when needed; flag now.
2. **No `schema_version` row.** `_bootstrap` exists as a placeholder singleton from migration 0001 but holds no meaningful version. The `sqlx_migrations` table sqlx maintains is fine for ordering, but apps that want to gate behaviour on schema version don't have a single SQL-readable answer.
3. **No `pg_stat_statements`** enabled. By Phase 6 you'll want it to find slow queries.
4. **No partial unique indexes for V1 single-user → multi-user pivot.** The DECISIONS.md note ("when multi-user lands, add `owner_id` and a partial unique index per owner") is correct but not stubbed. Easy: when `owner_id` lands, every `UNIQUE (name)` becomes `UNIQUE (owner_id, name)` — but `decks.name` and `collections.name` currently have **no** uniqueness constraint at all, so renaming will be a non-issue. Worth deciding whether you *want* a per-(owner) name uniqueness before Phase 5 forms ship.
5. **`cards.legalities jsonb`** — there is no GIN index on it. Filtering by format (`c.legalities ->> $1 = 'legal'`) does a sequential scan today. With ~30k oracle cards that is ~5–20ms, fine, but a `CREATE INDEX cards_legalities ON cards USING gin(legalities)` would future-proof.
6. **`printings.image_uris jsonb` and `prices jsonb`** are stored verbatim. Stable from Scryfall, but consider extracting `image_uris->>'normal'` into a `image_normal` text column for cheap card-grid rendering without a `->>` per row.
7. **No audit columns on tag tables.** `card_effect_tags` and `card_functional_roles` have `created_at` but no `updated_at`/`updated_by`. When a manual override is later refined, you can't tell when it was last touched. Add `updated_at` + a trigger (cheap symmetry with the rest of the schema).
8. **No soft-delete pattern.** `deck_entries` and `collection_entries` use `ON DELETE CASCADE`. For V1 this is correct (delete means delete). For Phase 8+ you'll want to consider undo or an event log; flag, don't fix.

### Smaller notes

- The `_bootstrap` singleton table from `0001_init.sql` is harmless but no longer needed. Could be dropped in `0006` once Phase 5 ships, just for hygiene.
- The unique constraint on `printings (set_code, collector_number, lang)` is correct, but Scryfall does have "variation" rows where the same set+collector_number repeats. The PK is `id` (Scryfall's printing UUID) so duplicates won't break insertion; the UNIQUE could fire on variation collisions. Worth a fixture test once you hit a real variation row.

---

## 4. Frontend (React / Vite / TS)

### Strengths

- **TS strict + every safety knob on.** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`. Better than most established codebases.
- **Path alias `@/*` → `src/*`** wired in both `tsconfig.json` and `vite.config.ts`. Good ergonomics.
- **`main.tsx` mounts via a hard `throw new Error()` if `#root` is missing**, not a non-null assertion. Aligns with the project-wide CLAUDE.md "never use `!` unless necessary" rule.
- **`QueryClient` defaults are sensible**: `staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 1`. Won't thrash, won't silently re-fetch on tab focus.
- **Tailwind config maps theme keys (`colors.surface`, `colors.fg`, `fontFamily.sans/serif/mono`, `borderRadius`, `boxShadow`, `transitionDuration`) to CSS custom properties from `branding/tokens.css`.** This is the right architecture: the tokens are the contract, Tailwind is the consumer, dark mode comes for free via `[data-theme="dark"]` and `prefers-color-scheme`. The `App.tsx` health-probe page already uses `text-fg-subtle`, `bg-surface-raised`, `font-serif`, etc., so the tokens are not just declared but *consumed*.
- **`index.css` correctly enables `font-variant-numeric: tabular-nums`** on `.font-mono`, `table`, and `[role="grid"]` — exactly right for MTG data display.

### Issues

1. **shadcn/ui not installed.** The stack contract says shadcn/ui; no `components.json`, no `components/ui/` folder, no `clsx` / `tailwind-merge` / `cva` / `lucide-react` deps. Phase 6+ component work will be hand-rolled CSS-against-Tailwind unless this is set up first. Adoption is a one-time `pnpm dlx shadcn@latest init`. **Important nuance: shadcn uses `:root` CSS variables for theming — your `branding/tokens.css` already does this and Tailwind already reads them; integration will require harmonising the shadcn-conventional variable names (`--background`, `--foreground`, `--primary`, `--muted-foreground`, etc.) with your Field-Manual-named ones (`--color-surface`, `--color-fg`, …). Decide now: either (a) rename your tokens to shadcn names, or (b) generate a shadcn-compatible alias layer in `tokens.css`.** Option (b) is non-destructive and probably the right call.
2. **No `react-hook-form` + `zod` yet.** Forms haven't shipped, so not urgent — but Phase 5 collections-CRUD will need both, and the FE error-handling pattern (per project CLAUDE.md: "Show actual error from schema") depends on it.
3. **`client.ts` is a hand-rolled fetcher.** Now that `schema.ts` types are generated, the natural next step is `openapi-fetch` (~3KB), which gives you `client.GET("/api/cards/search", { params: { query: { q: "lightning" } } })` with full type narrowing for path/query/response. The hand-rolled `request<T>` + `qs(params)` works but defeats half the value of having a generated schema.
4. **No global error boundary.** A render-time exception currently white-screens the whole app. `react-router` v6.4+ has `errorElement` per route — the current router has only one route with no `errorElement`.
5. **Single-route router.** `router.tsx` has one entry: `/ → <App />`. Will grow naturally but worth scaffolding `/cards`, `/cards/:oracleId`, `/collections`, `/decks` route stubs with lazy-loaded route components before Phase 5 lands real screens — keeps route data loading consistent.
6. **No theme toggle.** `tokens.css` supports `data-theme="dark"` *and* `prefers-color-scheme: dark` — the FE never sets `data-theme`, so the user's only path to dark mode is the OS preference. A small `<ThemeToggle>` storing the preference in `localStorage` would close the loop.
7. **Health probe re-fetches on every mount.** With `staleTime: 30_000` it won't refetch within 30s, but on every navigation it will check the cache. Fine; flag as future-tuning.
8. **`<App />` has no `Suspense` boundary.** With lazy-route loading coming, a fallback `<Suspense>` is owed.

### Smaller notes

- `eslint.config.js` is flat-config v9, correctly ignores `dist`, `node_modules`, and the generated `schema.ts`. Includes `react-hooks` and `react-refresh` plugins. Missing: `eslint-plugin-jsx-a11y` (worth adding once components ship), and the `@typescript-eslint/no-explicit-any` rule isn't enforced explicitly (covered by `tseslint.configs.recommended` though).
- `web/dist/` is gitignored but exists in the working tree (build artifact). Fine.
- Google Fonts are loaded via `<link>` in `index.html` (Inter / JetBrains Mono / Roboto Slab). Phase 7 will want self-hosting via `@fontsource/*` for offline-first / Cloudflare-friendliness.

---

## 5. API Contract (OpenAPI / Rust ↔ TS)

### Strengths

- **The loop works end-to-end.** `utoipa` annotations on handlers + `ApiDoc` struct + `SwaggerUi::new("/docs").url("/openapi.json", api_doc)` exposes a live OpenAPI document at `http://localhost:8080/openapi.json`. `make codegen` runs `openapi-typescript http://localhost:8080/openapi.json -o src/lib/api/schema.ts` and produces a clean, ~300-line schema. The Phase 5 WIP already consumes `components["schemas"]` and `operations["search_cards"]` types from the generated file — the boundary is genuinely type-safe.
- **Per-handler `#[utoipa::path(...)]` co-locates docs with the code.** Inline doc-comments on `SearchQuery` fields propagate to the generated TS as `@description` JSDoc.
- **All non-`200` responses are declared.** `get_card` declares `404` explicitly. No drift between code and spec for happy-path returns.

### Issues

1. **The codegen step is manual.** `make codegen` only runs when a human invokes it. There is no pre-commit hook, no CI step that fails if `schema.ts` is stale, and no API change-detector. The pattern that works long-term: a CI step that runs `make codegen` and then `git diff --exit-code` — if the schema is stale, CI fails and the PR author has to commit the regenerated file. Without this, `schema.ts` and reality will drift the first time someone updates a handler in a hurry.
2. **`schema.ts` is generated against a *running API*.** That means CI cannot regenerate it without booting Postgres + the API binary. Two paths: (a) have `tutor-api` accept a `--dump-openapi <path>` subcommand and call that in CI instead of curl'ing a live server; (b) extract `ApiDoc::openapi()` into a tiny build-time binary. Either is small; today CI never validates the schema.
3. **`jsonb` columns expose as `unknown`.** As noted in §2.6 — `legalities`, `image_uris`, `prices` all serialize to TypeScript `unknown`. The frontend can't safely read `legalities.commander === "legal"` without a runtime `zod` validator. Define proper structs.
4. **No `ApiError` schema in the OpenAPI spec.** When R2 adds a structured error shape, register it once and reference it from every endpoint's error responses.
5. **No `errors` array in `/openapi.json`.** No per-endpoint `400`/`500` documented. Once R10 (structured errors) lands, every handler should declare its 4xx/5xx variants.

---

## 6. Docker Dev Loop

### Strengths

- **Postgres-only compose.** Just one service (`postgres:16-alpine`), one named volume (`tutor_pg_data`), one healthcheck, one mapped port (host 55432 → container 5432). API + Web run on the host. This is the simplest possible local-first dev story and avoids `cargo` recompile thrash inside containers.
- **`make dev` is one command.** Brings up Postgres, waits for `pg_isready`, then spawns `cargo run` and `pnpm dev` in parallel under a `trap 'kill 0' INT TERM EXIT`. New contributor goes from clone → working server in three commands (`cp .env.example .env`, `make bootstrap`, `make dev`).
- **`make db-reset` actually nukes the volume.** `docker compose down -v` + `db-up`. No drift between a "clean" dev machine and a freshly-cloned one.
- **`.env.example` is checked in; `.env` is gitignored.** Verified — `git ls-files` shows `.env.example` only.
- **Port 55432, not 5432.** Avoids the classic "I already have system Postgres" clash. Documented in `README.md`.

### Issues

1. **API runs on the host, so it depends on a local `rustup` toolchain at the version `rust-version = "1.78"`.** Documented in README. New contributor onboarding has more moving parts than "docker compose up". For Phase 7+ consider a `Dockerfile` for the API binary (multi-stage `cargo chef` build) — even if `make dev` continues to run on the host.
2. **No DB seeding.** `make ingest-all` downloads ~150MB and runs ~5–10 minutes. There is no "lite" seed for new contributors (e.g. 100 sample cards) — they have to wait or skip. Worth adding a `data/seed.sql` with 50–100 hand-picked oracle rows + sets + printings checked in.
3. **No log volume / log driver tuning.** Compose uses the default driver; fine.
4. **No Postgres extension preloading.** Migrations enable `pgcrypto` + `pg_trgm` on first boot, which works. But `pg_stat_statements` (R8) requires a `shared_preload_libraries` change in `postgresql.conf` — can't be done by `CREATE EXTENSION` alone. Adding it now means a compose file change later.
5. **`api/data/scryfall/` is bind-mounted implicitly via being in the API working dir.** Fine on host execution; if the API ever runs in a container the path needs to be a mounted volume.

### Smaller notes

- The inotify-watcher note in the README is a nice touch for Linux contributors.
- No `.dockerignore` exists yet (none needed while only Postgres is in compose).

---

## 7. Tests

### What exists

| Layer | Where | What it covers |
|---|---|---|
| Rust ingest unit/integration | `api/tests/ingest_fixtures.rs` | 3 tests: `upsert_sets` idempotent; `upsert_oracle_cards` creates faces and is idempotent; `upsert_printings` links to oracle. Uses `#[sqlx::test(migrations = "./migrations")]` for per-test ephemeral databases. |
| Rust handler integration (uncommitted Phase 5) | `api/tests/cards_browse.rs` | 6 tests: name search, color identity subset, set-via-printings, pagination, detail with faces+printings, 404. Calls handlers directly with constructed extractors. |
| FE unit | `web/src/App.test.tsx` | 1 test: stub `fetch`, render `<App />`, assert "connected" + version are shown. |

### Strengths

- **`#[sqlx::test(migrations = "./migrations")]` per-test ephemeral Postgres** is the gold standard for SQLx testing. Real migrations, real triggers, real constraints, real JSONB. No mocking. Tests are slow-ish but correct.
- **Fixtures (`tests/fixtures/{sets,oracle_cards,printings}.json`)** are hand-crafted to cover a single-face card (Lightning Bolt), a single-face land with `produced_mana` (Boseiju), and a transform card with faces (Wrenn and Realmbreaker). Good coverage shape for ~7 lines of fixture each.
- **Phase 5 handler tests verify schema joins.** `detail_returns_faces_and_printings` asserts `detail.faces[0].face_index == 0` and `set_name` is populated through the join.

### Gaps

1. **No Axum-router level test.** All handler tests call `search_cards(State, Query)` directly. They bypass routing, middleware, JSON serialisation, status codes, and `IntoResponse`. The right pattern is `Router.oneshot(Request)` against `build_router(state)` from `lib.rs`. Wiring is ~10 lines and gives confidence that:
   - the route path is correct
   - `IntoResponse` produces the right `Content-Type` and status code
   - middleware (CORS, request-id, error mapping) actually runs
2. **No FE integration test against a real backend.** `App.test.tsx` stubs `fetch`. The OpenAPI-generated client has never been exercised end-to-end in CI.
3. **No e2e test.** Playwright is listed in the stack contract. No `playwright.config.ts`, no `e2e/` directory, no Playwright dep in `package.json`. Phase 7 (production hosting) cannot ship safely without at least one smoke test.
4. **No FE component or hook tests for the API client.** `client.ts` builds query strings, handles `ApiError`, parses JSON-vs-text content types — none of this is tested.
5. **No `httpmock` / `wiremock` for Scryfall.** The Scryfall HTTP client (`scryfall/client.rs`) is exercised only at ingest time. The retry/backoff path and the rate-limit gate are not unit-tested.
6. **`db::connect` / `db::migrate`** are not tested directly. Not critical (they're 4 lines each), but a "connecting to an unreachable URL returns a clear error" test would catch breaking changes to the pool config.

---

## 8. CI/CD

### Strengths

- **Two parallel jobs (`rust`, `web`)** in one workflow, matching the repo's two halves. Both pinned to `ubuntu-latest`.
- **Rust job runs `fmt --check`, `clippy -D warnings`, and `cargo test --all`.** All three gates are blocking. `Swatinem/rust-cache@v2` is used, which is the right cache action.
- **Web job runs `typecheck`, `lint`, and `test`.** Uses `pnpm/action-setup@v4` with `pnpm install --frozen-lockfile`. Correct.
- **Node 20 LTS is pinned.** pnpm v9 is pinned.
- **`SQLX_OFFLINE: "true"` is set globally** — at least the *intent* of offline checking is encoded, even if no macros exist yet to consume the cache.

### Issues

1. **The Rust `test` job needs Postgres for `#[sqlx::test]` to work.** Looking at the CI YAML, no `services:` block is defined and no `DATABASE_URL` env is set. Either (a) the tests are silently being skipped (cargo only compiles them), or (b) they fail and the job is somehow passing, or (c) `#[sqlx::test]` is using sqlx's "auto-create ephemeral DB on a default URL" and that URL isn't there in CI. Most likely the tests *do not run* in CI right now. **This is the single most important CI gap. Verify by checking recent CI runs.** If they don't run, add a `services: postgres: image: postgres:16-alpine ...` block, export `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`, and `cargo test --all` will work.
2. **No `cargo audit` / `cargo deny`** for advisories or license/banned-dep policy. Both are stable and one job each.
3. **No `pnpm audit`** for FE deps.
4. **No `make codegen + git diff` check.** As noted in §5.1, `schema.ts` can drift from `openapi.json` without CI noticing.
5. **No Playwright job.** Phase 7 will need at least one smoke run against a `docker compose`-up'd stack.
6. **No build artefact validation.** `pnpm build` (`tsc -b && vite build`) is not run in CI. Lint + typecheck + test pass, but the production bundle could fail.
7. **No `concurrency:` group** — two pushes to `main` race; usually fine, but worth setting `concurrency: { group: ${{ github.ref }}, cancel-in-progress: true }` for PR-pile-up days.

### Smaller notes

- The workflow has `working-directory: api` and `working-directory: web` set as defaults for each job — clean.
- No matrix strategy yet. Single Rust toolchain (stable), single Node version. Fine for V1; add `nightly`-on-soft-fail when policy stabilises.

---

## 9. Dependencies

### Rust (from `Cargo.toml` + `Cargo.lock`)

| Crate | Workspace pin | Resolved (`Cargo.lock`) | Notes |
|---|---|---|---|
| `axum` | 0.7 | 0.7.9 | Current; 0.8 is out (2025-12). Not urgent — 0.7 has fixes through this year. |
| `sqlx` | 0.8 | 0.8.6 | Current minor. Good. |
| `tokio` | 1 (full) | 1.52.3 | Current. |
| `tower` | 0.5 | 0.5.3 | Current. |
| `tower-http` | 0.6 | (transitive) | `compression-gzip` feature requested but compressor not actually applied (no `CompressionLayer` in the router). |
| `reqwest` | 0.12 | 0.12.28 | Current. `default-features = false` + `rustls-tls` is correct (no OpenSSL system dep). |
| `utoipa` | 5 | 5.5.0 | Current. Phase 5 WIP adds `chrono` + `uuid` features (in branch diff). |
| `utoipa-swagger-ui` | 8 | (transitive) | Current. |
| `hyper` | (transitive) | 1.9.0 | Current. |
| `serde` / `serde_json` | 1 / 1 | — | Current. |
| `tracing` / `tracing-subscriber` | 0.1 / 0.3 | — | Current. The `json` feature on subscriber is requested but `fmt::layer()` (not `.json()`) is used in both `main.rs` and `ingest.rs`. Either drop the `json` feature or switch to `.json()` for prod-shaped logs. |
| `anyhow` / `thiserror` | 1 / 1 | — | Current. |
| `dotenvy` | 0.15 | — | Current; pretty much frozen. |
| `chrono` | 0.4 | — | Current. |
| `uuid` | 1 (v4, serde) | — | Current. |
| `clap` | 4 (derive, env) | — | Current. Used by `tutor-ingest`; could be the basis for a `tutor-api` config struct (see §2.5). |
| `futures` | 0.3 | — | Used by `download_to`'s `bytes_stream().next()`. |
| `indicatif` | 0.17 | — | Progress bars for `tutor-ingest`. |

No crates are conspicuously stale. The workspace pins are coarse (single major), so `cargo update` will keep things current. There is **no `[workspace.lints]`** table — clippy lints are enforced via CI only (`-D warnings`); adding `[workspace.lints.clippy]` with project-wide `pedantic = "warn"` (or a curated subset) would surface common issues at edit time.

### TypeScript (from `web/package.json`)

| Package | Pinned | Notes |
|---|---|---|
| `react` / `react-dom` | ^18.3.1 | Current 18.x. React 19 stable but not yet recommended for new product code. |
| `react-router-dom` | ^6.27.0 | Current. v7 is out as a soft-fork — staying on v6 is fine. |
| `@tanstack/react-query` | ^5.59.0 | Current. |
| `vite` | ^5.4.8 | Current. Vite 6 is out — non-breaking upgrade, can be deferred. |
| `typescript` | ^5.6.2 | Current. |
| `vitest` | ^2.1.1 | Current. |
| `tailwindcss` | ^3.4.13 | Current. Tailwind v4 alpha exists; stay on 3 for now. |
| `openapi-typescript` | ^7.4.1 | Current. |
| `eslint` | ^9.11.1 (flat) | Current. |
| `@testing-library/react` | ^16.0.1 | Current. |

Notably absent:

- `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/*` — all needed when shadcn/ui lands.
- `react-hook-form`, `zod`, `@hookform/resolvers` — needed for Phase 5 forms.
- `openapi-fetch` — would replace the hand-rolled `request<T>` helper.
- `playwright` / `@playwright/test` — needed for e2e.
- `msw` — useful for FE-side testing of API failure modes.

Lockfile: `pnpm-lock.yaml` is present and CI uses `--frozen-lockfile`. Healthy.

---

## 10. Tech Debt & Risk

Ranked by what will hurt at Phase 5+ if left:

1. **Runtime SQL.** The longer the codebase grows on `sqlx::query(...)`, the more painful the macro switch becomes. Every new endpoint + every taxonomy join + every collection mutation is another query to retrofit. Address before Phase 5 grows.
2. **Opaque server errors.** Without a structured `ApiError` shape, the FE can't surface "duplicate entry" vs "validation failed" vs "server bug" differently. The very first Phase 5 mutation (`POST /collections`) will surface this gap immediately.
3. **CI not actually running DB tests.** If §8.1 is right, every passing CI run since Phase 3 has been *not running* the integration tests. The fix is small (a `services:` block) but the consequence — silently green CI — is the worst class of CI bug.
4. **No e2e + no Axum router test.** Today the test suite couldn't catch a wrong route path, a misconfigured middleware, or a CORS header drop. Phase 5 ships forms; without e2e you cannot regress-test the UI flow.
5. **`legalities` / `image_uris` as opaque jsonb.** The TS side is `unknown`; the SQL side has no index on legalities. Two real fixes (typed structs + jsonb GIN); both are small.
6. **shadcn/ui adoption lag.** Phase 5 is starting to ship UI. Either land shadcn first (so the first component is built on the agreed stack) or accept that components will be hand-rolled and migrated later (and refactor cost grows linearly with screen count).
7. **No `.sqlx/` offline cache + `SQLX_OFFLINE=true` in CI.** Becomes a CI failure the day you adopt `query!` macros. Trivial to bootstrap with `cargo sqlx prepare --workspace`.
8. **No request-id / no timeout / no body-size limit / no CORS.** Each one is a small library function. None block development today; all of them block prod hardening at Phase 7.
9. **No FTS column on `cards`.** Phase 6 effect-tag search will want it. Add when Phase 6 ramps.
10. **Two un-tracked source files on the working branch.** `api/src/routes/cards.rs` and `api/src/routes/sets.rs` are not yet committed (along with `api/tests/cards_browse.rs`). Phase 5 commit hygiene will handle this; flag.

Risks that are *not* present and worth noting positively:

- No `unwrap()` / `panic!()` in production paths.
- No global mutable state in Rust.
- No `any` in TypeScript (with strict mode on, the compiler enforces this).
- Migrations are forward-only, never edited in place.
- Scryfall etiquette is real (real gate, real backoff).
- Frontend doesn't hard-code the API origin (uses Vite proxy + `VITE_API_URL` override).
- Brand tokens are consumed by Tailwind theme, not pasted as hex.

---

## 11. Recommendations Backlog (Engineering)

> Effort: S = under a day, M = 1–3 days, L = 3+ days. Risk = chance of breaking something else when applied. Priorities: P0 = before Phase 5 grows; P1 = during Phase 5; P2 = Phase 6 entry; P3 = Phase 7 (deploy hardening).

### R1. Adopt `sqlx::query!` macros + check in `.sqlx/` offline cache
- **Why.** The whole reason SQLx was chosen. Today every query is runtime; a column rename or type drift only surfaces at HTTP call time. With macros, `cargo check` becomes a schema regression test for free.
- **Phase/Priority.** Phase 5 — **P0**.
- **Effort.** M (~20 queries to migrate; build `.sqlx/` with `cargo sqlx prepare --workspace`; wire `SQLX_OFFLINE=true` in CI to actually consume it).
- **Risk.** low.

### R2. Structured `ApiError` payload
- **Why.** `{"error": "internal error"}` is unactionable for the FE. Introduce `{code, message, request_id, details?}` with explicit variants: `NotFound`, `BadRequest`, `Conflict`, `UnprocessableEntity`, `Internal`. Map SQLx unique-violation errors to `Conflict` automatically.
- **Phase/Priority.** Phase 5 — **P0**.
- **Effort.** S (one file change in `error.rs`, register schema in `openapi.rs`).
- **Risk.** low (additive on the wire; FE can adopt incrementally).

### R3. Axum hardening middleware
- **Why.** CORS, request-id, timeout, body-size limit, compression — minimum viable production posture. The `tower-http` features are already pulled in; the layers aren't applied.
- **Phase/Priority.** Phase 5 — **P0**.
- **Effort.** S (~20 lines in `build_router`).
- **Risk.** low. Verify the dev-time Vite proxy still works (it should — CORS only matters when origins differ).

### R4. Axum-level HTTP integration tests
- **Why.** Today's handler tests bypass routing, middleware, and serialisation. Add a `tests/http.rs` that uses `build_router(state).oneshot(Request::builder()...)` to exercise the real surface.
- **Phase/Priority.** Phase 5 — **P1**.
- **Effort.** S (one file; share fixture seeding helpers with existing `cards_browse.rs`).
- **Risk.** low.

### R5. Install shadcn/ui scaffolding before Phase 6 UI
- **Why.** Stack contract specifies it; first real components ship in Phase 5/6. Install before, not after, to avoid retrofitting. Decide tokens-renaming policy (rename to shadcn names, or alias-layer in `tokens.css`) up front.
- **Phase/Priority.** Phase 5 (preferably late) — **P1**.
- **Effort.** S–M (init + token harmonisation + a `Button` and an `Input` to prove the wiring).
- **Risk.** low.

### R6. `cargo deny` + `cargo audit` + `pnpm audit` in CI
- **Why.** Supply-chain advisories and unintentional licence drift. Both stable, both one-job-each.
- **Phase/Priority.** Phase 5 — **P1**.
- **Effort.** S.
- **Risk.** low (audit failures are advisory until policy is set).

### R7. Playwright + one smoke test
- **Why.** Phase 7 cannot ship without e2e. Start with one test: "GET /, see 'connected'" against a `make dev`-ish stack in CI.
- **Phase/Priority.** Phase 6 — **P1**.
- **Effort.** M (test infra + a `docker-compose.ci.yml` that includes the API binary).
- **Risk.** low.

### R8. `schema_version` row + `pg_stat_statements` extension + migration policy doc
- **Why.** Phase 6 (tagging engine) and Phase 7 (deploy) both want machine-readable schema version. `pg_stat_statements` is preload-only so it must be in compose now to be available later.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S (migration 0006 + compose `command:` override).
- **Risk.** low.

### R9. Replace hand-rolled fetcher with `openapi-fetch`
- **Why.** `openapi-fetch` consumes `schema.ts` directly and gives you per-path type-narrowed `GET`/`POST`/etc. The current `request<T>` + `qs()` works but duplicates what the generator already knows.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S.
- **Risk.** low (one file).

### R10. Per-route OpenAPI error responses
- **Why.** Each handler should declare the 4xx/5xx variants it can produce (referencing the R2 `ApiError` schema). Drives TS narrowing on the FE.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S (touches every handler — ~5 lines each).
- **Risk.** low.

### R11. CI step: regenerate `schema.ts` and `git diff --exit-code`
- **Why.** Without this, the generated client can drift behind the API. The cleanest implementation is `tutor-api --dump-openapi /tmp/openapi.json` (so CI doesn't need a live server) + `openapi-typescript /tmp/openapi.json -o web/src/lib/api/schema.ts` + diff check.
- **Phase/Priority.** Phase 5 — **P1**.
- **Effort.** S (add a `--dump-openapi` flag to the bin, a one-line CI step).
- **Risk.** low.

### R12. `services: postgres` block in CI Rust job + explicit `DATABASE_URL`
- **Why.** Verify (and if missing, restore) actual execution of `#[sqlx::test]` integration tests. Today the absence of a Postgres service strongly suggests they are not running.
- **Phase/Priority.** Phase 5 — **P0** (verify first; if running, downgrade to no-op).
- **Effort.** S.
- **Risk.** low.

### R13. Typed `legalities` + JSONB GIN index
- **Why.** Phase 5 search by format hits `legalities ->> $1` with a seq-scan today; the FE can't read `legalities.commander` safely. Define `Legalities` struct + `CREATE INDEX cards_legalities ON cards USING gin(legalities)`.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S.
- **Risk.** low.

### R14. Lite Postgres seed for new contributors
- **Why.** `make ingest-all` takes 5–10 minutes and 150MB. A `data/seed.sql` with ~100 oracle cards + 5 sets + 200 printings, loaded by `make db-seed`, gets new contributors a working UI in seconds.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S.
- **Risk.** low.

### R15. Global error boundary + per-route `errorElement` on the FE
- **Why.** Today a render-time exception white-screens. Standard react-router v6 pattern with one `RootErrorBoundary` and per-route fallbacks.
- **Phase/Priority.** Phase 5 — **P1**.
- **Effort.** S.
- **Risk.** low.

### R16. Theme toggle (light/dark) backed by `data-theme` + `localStorage`
- **Why.** `tokens.css` supports both `[data-theme="dark"]` and `prefers-color-scheme`; the FE never sets the attribute. Brand promise unfulfilled.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S.
- **Risk.** low.

### R17. `Config` struct + `clap` for API startup
- **Why.** Centralise env-var parsing, fail loud on missing required vars at startup, and give `tutor-api --dump-openapi <path>` (per R11) a clean home.
- **Phase/Priority.** Phase 5 — **P2**.
- **Effort.** S.
- **Risk.** low.

### R18. `[workspace.lints.clippy]` with a curated `pedantic` subset
- **Why.** Lint at edit-time, not just CI-time. Catches small things (`needless_pass_by_value`, `unnecessary_wraps`) before they propagate.
- **Phase/Priority.** Phase 5 — **P3**.
- **Effort.** S.
- **Risk.** low (start `pedantic = "warn"`, escalate to deny once the codebase is clean).

### R19. `httpmock` (or `wiremock`) test for the Scryfall client
- **Why.** Validates the rate-limit gate, 429 retry, and bulk-download path without ever calling Scryfall. Single test catching a regression saves a network-round-trip debugging session.
- **Phase/Priority.** Phase 6 — **P2**.
- **Effort.** S.
- **Risk.** low.

### R20. `audit_log` table or event stream for mutating endpoints
- **Why.** Phase 5+ (collections/decks mutate state). When users notice "I lost a card from my binder", you need a server-side log to investigate. Cheap to add now (one table + a `trigger`-based row-version log, or per-mutation app-layer writes), painful to retrofit.
- **Phase/Priority.** Phase 5 — **P3**.
- **Effort.** M.
- **Risk.** medium (schema additions; pick the pattern carefully to avoid write amplification).

### R21. Multi-stage Dockerfile for the API (cargo-chef)
- **Why.** Phase 7 deploy. Cache deps once, rebuild only on source changes; ~30s incremental image builds.
- **Phase/Priority.** Phase 7 — **P3**.
- **Effort.** M.
- **Risk.** low.

### R22. Drop the `_bootstrap` placeholder table
- **Why.** Migration 0001 is now superseded. Pure hygiene — remove in migration 0006.
- **Phase/Priority.** Phase 5 — **P3**.
- **Effort.** S.
- **Risk.** low.

### R23. Replace Google Fonts `<link>` with `@fontsource/*`
- **Why.** Offline-first dev; Cloudflare-friendly prod. Removes a runtime third-party dependency from page load.
- **Phase/Priority.** Phase 6 — **P3**.
- **Effort.** S.
- **Risk.** low.

### R24. CORS, body-size, and timeout configuration sourced from `Config`
- **Why.** Once R3 + R17 land, make the values configurable (not hard-coded) so prod and dev can differ.
- **Phase/Priority.** Phase 7 — **P3**.
- **Effort.** S.
- **Risk.** low.

### R25. Add an `eslint-plugin-jsx-a11y` config and `prefers-reduced-motion` audit
- **Why.** Phase 1's brand brief leans heavily on calm/considered UX; accessibility regressions during fast UI iteration are the most common failure mode. Token already supports `prefers-reduced-motion`; let's keep components honest.
- **Phase/Priority.** Phase 6 — **P3**.
- **Effort.** S.
- **Risk.** low.
