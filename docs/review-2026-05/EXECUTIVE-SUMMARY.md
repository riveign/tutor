# Tutor Project Review — Executive Summary

## The State of the Project

Tutor is four phases in (brand seed, brand finalize, scaffold + Rust/React + Docker Postgres, schema, Scryfall ingest) and is in **genuinely good shape** for a solo-dev + Claude-agents codebase at this age. The V1 scope is locked and visible in two places, the brand brief is unusually well-articulated, the Phase 3 schema correctly splits oracle from printing and respects Scryfall's identifier system, and the agent definitions are crisp enough to route work cleanly. **The weak spots are uniformly "written contract vs. shipped reality" gaps** — promises in prose that the code or assets don't yet honor: SQLx compile-time checking is promised but unused (every query is runtime); WCAG AA is promised but four token pairs fail; "bracket" is a V1 deck attribute but doesn't exist in any migration; shadcn/ui is in the stack contract but not installed; Scryfall attribution is promised but no surface exists. None are blocking — but addressing the top P0s before Phase 5 grows would prevent the most likely failure modes (silently green CI, opaque errors when forms ship, stale codegen, scope drift on the first ambiguous deliverable). The single largest dependency in the project is **MTG taxonomy content** — the schema exists, but the markdown specs for effect-tags and functional-roles must land before Phase 6 (tagger) and V1.4 (deckbuilder) can begin.

## The Top 5 Things to Do This Week

1. **BL-01 — Add project-scoped `CLAUDE.md`.** Single highest-leverage agent fix; sessions currently inherit ~600 lines of WalletConnect/TypeScript guidance that have no Rust analog.
2. **BL-13 — Adopt `sqlx::query!` macros + check in `.sqlx/`.** The whole reason SQLx was chosen; today zero macros and `SQLX_OFFLINE=true` is a dormant no-op. Window closes the longer the codebase grows on runtime SQL.
3. **BL-16 — Verify CI Rust job actually runs `#[sqlx::test]`.** No `services: postgres`, no `DATABASE_URL` in CI YAML — every passing CI run since Phase 3 has likely not run the integration tests. Worst class of CI bug.
4. **BL-31 — Fix the four sub-WCAG-AA token pairs.** The brief's "AA-everywhere" promise is currently false (`fg-subtle` on `surface` = 2.95x; three more fail). Every downstream component inherits the failure.
5. **BL-44 / BL-45 — Author the Effect-Tag and Functional-Role taxonomy specs.** Phase 6 is blocked without them; the empty tables are illusory progress.

## The Top 3 Risks if Nothing Changes

1. **Silent CI regressions go undetected for weeks.** If `#[sqlx::test]` tests aren't running (BL-16), the next migration that breaks a query won't be caught until manual smoke at the FE — and may not even surface there if the FE doesn't exercise the affected path.
2. **Phase 5 ships forms against opaque `"internal error"` responses.** The first `POST /collections` mutation will hit a unique-constraint and the FE will have no way to distinguish duplicate-entry from server-bug — leading to either generic error toasts (violates brand voice) or expensive retrofitting after Phase 5 lands (BL-14).
3. **Taxonomy work blocks indefinitely.** Phase 6 tagger and V1.4 deckbuilder both require effect-tag + functional-role taxonomies as data. The schema is ready; the markdown specs are not authored; no agent currently has the spec writing on their explicit todo. Risk: V1.4 slips by months because the prerequisite content was never scheduled.

## How the 5 Audit Lenses See the Project

| Lens | Health (1-5) | Headline |
|---|---:|---|
| PM | 4 | Strong scope guard + decision log; missing per-phase artifacts and Phase 5 plan. |
| Engineering | 3 | Clean code, solid schema; runtime SQL, opaque errors, no middleware, possibly-skipped CI tests. |
| MTG | 2 | Schema-shape correct; **content unauthored** — no taxonomy, no bracket, missing Scryfall fields. |
| Brand | 3 | Excellent brief + tokens + Tailwind wiring; **broken AA contract**, no logo, no components, no wireframes. |
| Agents | 3 | Four good agent charters; **no project `CLAUDE.md`**, no skills, no hooks, no settings allow-list. |

## Where to Read More

- Full backlog: [`BACKLOG.md`](./BACKLOG.md) — 69 items across 5 clusters, prioritized P0->P3.
- PM lens: [`../audit/001-project-pm-state.md`](../audit/001-project-pm-state.md)
- Engineering lens: [`../audit/002-engineering-stack.md`](../audit/002-engineering-stack.md)
- MTG domain lens: [`../audit/003-mtg-domain.md`](../audit/003-mtg-domain.md)
- Brand/design lens: [`../audit/004-brand-design.md`](../audit/004-brand-design.md)
- Agent/tooling lens: [`../audit/005-agent-setup.md`](../audit/005-agent-setup.md)
