# Tutor — Agent Setup Audit

## Table of Contents

- [Executive Summary](#executive-summary)
- [1. Agent Definitions (tutor-pm, tutor-engineer, tutor-brand-design, tutor-mtg-expert)](#1-agent-definitions-tutor-pm-tutor-engineer-tutor-brand-design-tutor-mtg-expert)
- [2. Project-Level Claude Config](#2-project-level-claude-config)
- [3. Skills Inventory](#3-skills-inventory)
- [4. CLAUDE.md / PROJECT_AGENTS.md](#4-claudemd--project_agentsmd)
- [5. Memory / Persistence](#5-memory--persistence)
- [6. Orchestration Patterns](#6-orchestration-patterns)
- [7. Routing Clarity & Ownership Boundaries](#7-routing-clarity--ownership-boundaries)
- [8. Gaps (Missing Agents/Skills)](#8-gaps-missing-agentsskills)
- [9. Recommendations Backlog (Agent Setup)](#9-recommendations-backlog-agent-setup)

---

## Executive Summary

The Tutor project ships four well-written subagent definitions (`tutor-pm`, `tutor-engineer`, `tutor-brand-design`, `tutor-mtg-expert`) under `.claude/agents/`. The charters are concise, the cross-agent handoffs are stated explicitly, and the descriptions are crisp enough that an orchestrator can route most phase work without ambiguity. The repository is otherwise nearly bare on Claude Code infrastructure: there is no project-level `CLAUDE.md`/`AGENTS.md`, no skills, no hooks, no permission allow-list, no commands, no memory file, no spec directory, and `.claude/settings.local.json` only enables two MCP servers (`qmd`, `playwright`). The agents currently inherit everything from `~/Development/CLAUDE.md` and `~/Development/PROJECT_AGENTS.md`, which are oriented around WalletConnect/TypeScript conventions, not Rust + plain React.

**Top 5 findings**

1. Four high-quality agents, but routing depends on a parent `CLAUDE.md` written for a different stack (TypeScript-only error-handling/middleware patterns; no Rust analog). Agents are effectively inheriting irrelevant rules.
2. No project-scoped `CLAUDE.md` / `AGENTS.md` declares the Tutor stack to a fresh Claude session — every agent invocation re-discovers context from `README.md` + `DECISIONS.md`.
3. No tools/model restrictions on any agent — every agent runs with the default tool surface, which is wasteful for narrow roles like `tutor-brand-design` and `tutor-mtg-expert`.
4. No skills exist for the repetitive, scriptable parts of this project: Scryfall fetch with rate-limit etiquette, OpenAPI codegen, phase-handoff, decision-log append, WCAG token audit.
5. No hooks enforce the explicit "plan → approval → implement → verify" working agreement, the migrations-only rule, or the no-WotC-IP guardrail. They live as prose only.

**Top 8 recommendations** (full backlog in §9)

1. P0 / S — Add project-scoped `CLAUDE.md` (stack, conventions, commit format, do-not rules).
2. P0 / S — Add `tools:` allow-lists and `model:` per agent in their frontmatter.
3. P0 / S — Add `.claude/settings.json` allow-list for the high-frequency commands (`cargo`, `pnpm`, `sqlx`, `make`, `docker compose`).
4. P1 / M — Author `tutor-scryfall-fetch` skill encoding rate-limit + attribution + bulk-data etiquette.
5. P1 / S — Author `tutor-decision-log` skill that appends correctly formatted `DECISIONS.md` entries.
6. P1 / M — Author `tutor-phase-handoff` skill that codifies plan → approval → implement → verify.
7. P1 / S — Add `tutor-qa` (or expand engineer charter) to own Playwright/Vitest scenario design — currently nobody owns test plans.
8. P2 / S — Resolve ownership ambiguities: OpenAPI schema shape, taxonomy storage shape, UI microcopy.

**Next Steps**

- Land P0 items first (project CLAUDE.md + tool allow-lists + settings allow-list) in a single small PR — these unlock everything else and reduce permission-prompt friction immediately.
- Then prioritize the three P1 skills (scryfall-fetch, decision-log, phase-handoff) because each removes recurring per-invocation boilerplate.
- Defer adding new agents (qa, data-ingest auditor, release) until after the V1 schema phase finishes; route that work through `tutor-engineer` for now and split when load justifies it.

---

## 1. Agent Definitions (tutor-pm, tutor-engineer, tutor-brand-design, tutor-mtg-expert)

All four agent files live at `/home/mantis/Development/mantis-dev/tutor/.claude/agents/`:

- `tutor-pm.md` (3,058 bytes, last touched 14:48)
- `tutor-engineer.md` (3,408 bytes, last touched 14:56)
- `tutor-mtg-expert.md` (3,078 bytes, last touched 15:02)
- `tutor-brand-design.md` (2,725 bytes, last touched 15:07)

Each uses minimal YAML frontmatter (`name:` + `description:` only) followed by a charter, scope, working agreement, and explicit cross-agent handoff section. Quality observations:

**Strengths**

- `description:` fields are *trigger-rich* — they call out exactly when to invoke (e.g. tutor-pm: "Invoke at every phase kickoff, when scope is ambiguous, when the roadmap needs updating, or when a decision needs to be logged"). This routes well from an orchestrator.
- Each agent ends with a "How you work with the other agents" block. Together they form a complete bidirectional matrix (pm↔engineer, pm↔mtg-expert, pm↔brand-design, engineer↔mtg-expert, engineer↔brand-design, brand-design↔mtg-expert).
- Hard constraints (WotC IP, Scryfall etiquette, accessibility, type safety) are repeated in the agents most likely to violate them — defense in depth.
- V1 scope is locked into `tutor-pm` and clearly marks NOT-in-V1 items, which is exactly the right place to anchor the scope guard.

**Gaps**

- **No `tools:` field.** Every agent inherits the full tool surface. `tutor-mtg-expert` (research-focused) and `tutor-brand-design` (asset-focused) don't need Bash, while `tutor-engineer` doesn't need WebFetch on most invocations. Cf. Anthropic agent best practice of tool-scoping.
- **No `model:` field.** All agents implicitly use the parent session model. `tutor-pm` and `tutor-brand-design` could likely run on Haiku for cost savings on routine phase plans / token audits.
- **No `color:` field.** Cosmetic but useful for visually distinguishing agents in transcripts.
- **No version/owner metadata.** When charters drift, there's no record of who last updated and why.
- **No reference to `DECISIONS.md` format.** All four agents mention "log to `DECISIONS.md`" but none specify the entry shape (date / decision / reason / alternatives / who). The current file follows a convention only by example.
- **No reference to the test pyramid or QA hand-off.** Nobody owns Playwright scenario design, Vitest organization, or test-fixture seeding policy.

**Boundary clarity** — see §7 for full analysis.

## 2. Project-Level Claude Config

`.claude/` contents:

```
.claude/
├── agents/
│   ├── tutor-brand-design.md
│   ├── tutor-engineer.md
│   ├── tutor-mtg-expert.md
│   └── tutor-pm.md
└── settings.local.json   (65 bytes)
```

`settings.local.json` only enables MCP servers:

```json
{
  "enabledMcpjsonServers": ["qmd", "playwright"]
}
```

What is **not** present:

- No `.claude/settings.json` (project-shared settings) — every Bash invocation will trigger a permission prompt until accepted-per-session. For a project that uses `cargo`, `pnpm`, `sqlx`, `docker compose`, `make` constantly, this is a meaningful UX tax.
- No `.claude/hooks/` — no pre-commit guardrails, no PostToolUse formatters, no SessionStart context priming.
- No `.claude/commands/` — no project-specific slash commands.
- No `.claude/skills/` — see §3.
- No `output-styles/` — outputs are unstructured.

The `qmd` MCP server is enabled but qmd is configured for the WalletConnect knowledge base (collections "kb", "scopes", "kb-archive", "research") — none of those collections are about Tutor. Either disable it for this project or point qmd at Tutor docs.

## 3. Skills Inventory

**Project-level skills:** none. There is no `.claude/skills/` directory.

**Global skills available to this project** (from `~/.claude/skills/` and installed plugins):
- `omarchy`, `walletconnect-ux-copy-audit`, `wcp-design-principles`, `claude-api`, plus the `ac-workflow` and `ac-tools` plugin suites (mux, mux-roadmap, spec, product-manager, adr, agentic-export, improve-agents-md, milestone, etc.).

The available global skills are oriented toward WalletConnect work and meta-agentic-config tasks. None of them encode Tutor-specific procedure.

**Skills the project should add** (full motivation in §9):

- `tutor-scryfall-fetch` — rate-limit honoring fetch + bulk-data cache + attribution
- `tutor-decision-log` — append a properly formatted entry to `DECISIONS.md`
- `tutor-phase-handoff` — drive the plan-approval-implement-verify ritual
- `tutor-openapi-sync` — regenerate typed FE client after API changes (`make codegen`)
- `tutor-migration-new` — scaffold a new SQLx migration, including the `set_updated_at` trigger
- `tutor-token-audit` — run WCAG AA contrast checks on the design tokens
- `tutor-wotc-ip-scan` — grep for forbidden trademarks/symbols in PR diffs

## 4. CLAUDE.md / PROJECT_AGENTS.md

There is **no** `CLAUDE.md` or `AGENTS.md` at the Tutor project root. The hierarchy a Claude session loads, in order:

1. `/home/mantis/.claude/CLAUDE.md` — global user instructions (diagrams in Mermaid)
2. `/home/mantis/Development/CLAUDE.md` — generic project template (WalletConnect-flavored)
3. `/home/mantis/Development/PROJECT_AGENTS.md` — WalletConnect dev orchestrator config + TypeScript best practices + WalletConnect-specific authorization patterns
4. `/home/mantis/Development/mantis-dev/CLAUDE.md` — same generic template
5. *(no `/home/mantis/Development/mantis-dev/tutor/CLAUDE.md`)*

Consequences:

- The agents receive ~600 lines of TypeScript-specific guidance (`handlePromise` pattern, `osAuth.middleware`, `procedureAuth`, optimistic-update rollback) that have **no Rust equivalent** in this codebase. They will either misapply it or have to mentally subtract it.
- The agents receive the **walletconnect-agents delegate.sh** orchestration documentation that is irrelevant here.
- They do **not** receive any Rust-specific guidance (no `clippy` allow-rules, no SQLx query conventions, no `tracing` span guidance, no Axum extractor patterns, no `utoipa` annotation conventions).
- They do **not** receive Tutor-specific guardrails (no WotC trademark string list, no Scryfall attribution wording, no list of phase boundaries).
- The fallback "READ @PROJECT_AGENTS.md for project-specific instructions" instruction points to the parent's PROJECT_AGENTS.md — which is *not* Tutor's.

A project-scoped `CLAUDE.md` (or `AGENTS.md` for cross-tool compatibility) is the single highest-leverage missing artifact.

## 5. Memory / Persistence

The Claude Code memory directory exists but is empty:

```
/home/mantis/.claude/projects/-home-mantis-Development-mantis-dev-tutor/
├── 3007ec6a-...-c853595/       # session transcript dir
├── 3007ec6a-...-c853595.jsonl  # session log
├── d9ee71c1-...-358c85bad4/    # session transcript dir
├── d9ee71c1-...-358c85bad4.jsonl
└── memory/                     # EMPTY
```

Two session transcripts exist (today). No `MEMORY.md`, no compaction artifacts, no agent-state files. This is fine for now — early-phase projects don't have enough institutional memory to preserve — but the project should adopt a convention before phases 5+ when Scryfall ingest run outcomes, taxonomy decisions, and bracket-rules snapshots start accumulating.

There is also no `outputs/` discipline beyond two raw session dumps (`outputs/session/2579681`, `outputs/session/2590912`) — these appear to be ad-hoc and unstructured.

The `DECISIONS.md` file is the *de facto* memory artifact and is in good shape (10 entries, all dated, well-structured) but is hand-curated.

## 6. Orchestration Patterns

The project depends on the orchestrating Claude (parent session) to:

1. Read user request
2. Route to the right tutor-* agent based on the description triggers
3. Surface results back

Observations:

- The parent's plugin suite (`ac-workflow:mux`, `ac-workflow:spec`, `ac-workflow:mux-roadmap`, `ac-workflow:product-manager`) is rich and well-suited to phase orchestration. The current Tutor work is already using `ac-workflow:mux` (this audit lives under `tmp/mux/20260524-1632-tutor-project-review-backlog/`).
- No `specs/` directory exists at the project root, despite the `/spec` workflow being heavily referenced in parent `CLAUDE.md`. The project has chosen "phases tracked in `DECISIONS.md` + commits" over a formal `specs/<YYYY>/<MM>/<branch>/<NNN>-<title>.md` tree. That's a defensible choice for a single-person project but it means the `/spec` workflow guidance in the parent CLAUDE.md is dead weight (or worse, misleading).
- No phase boundary file exists. Commits encode phase boundaries through `feat(<scope>): Phase N — <summary>` but there is no enumeration of phases, status, or owner.
- The "plan → approval → implement → verify" working agreement is prose only; no hook enforces "did you get approval before coding?".

The MUX orchestration directory layout this audit lives in (`tmp/mux/.../audit/`, `audits/`, `research/`, `coordination/`, `deliverable/`, `consolidated/`, `.signals/`, `spy/`, `.trace`) is fully populated and demonstrates the agent setup *can* run MUX orchestration cleanly. Good signal.

## 7. Routing Clarity & Ownership Boundaries

The four agents cover product, implementation, domain, and design. For a single-user MTG app at this scope, four agents are appropriate — neither too few nor too many.

**Clear-cut routing (no ambiguity)**

| Task | Owner |
|---|---|
| Phase plan, acceptance criteria, scope guard | `tutor-pm` |
| `DECISIONS.md` entries (the act of logging) | `tutor-pm` (curator) |
| Rust handler implementation, SQLx queries, migrations | `tutor-engineer` |
| OpenAPI annotations, codegen | `tutor-engineer` |
| Token values, palette, typography, logo | `tutor-brand-design` |
| WCAG audit, accessibility patterns | `tutor-brand-design` |
| Effect-tag taxonomy, role taxonomy, bracket rules | `tutor-mtg-expert` |
| Scryfall data semantics (DFC, MDFC, finishes) | `tutor-mtg-expert` |

**Ambiguous ownership (needs explicit resolution)**

1. **OpenAPI schema shape (path / body / response).** Engineer says "I own the API". PM says "I define acceptance criteria". The shape of an endpoint encodes both. Today the engineer would own it but the PM might want a say on naming for client-visible fields. → Recommend: schema *shape* = engineer, but PM signs off on user-facing field names (e.g., `acquisition_source` vs `obtained_from`).
2. **MTG-correct UI microcopy.** Brand owns "labels and microcopy" tone. MTG-expert owns "MTG-correct" vocabulary. Brand's working agreement says "tutor-mtg-expert validates the MTG vocabulary used in labels and microcopy" — good — but the order (brand drafts, MTG validates) is not stated. → Recommend: make it explicit in `tutor-brand-design`.
3. **Schema fields with MTG meaning.** Engineer implements; MTG-expert specifies. But for fields like `affects_board_on_cast` (tutor-derived flag listed in DECISIONS.md): is the *definition of "affects the board"* MTG-expert's? The *column type and trigger logic* engineer's? Both, but the handoff isn't documented. → Recommend: MTG-expert authors a one-page "field semantics" doc for each non-Scryfall column.
4. **Test plans / Playwright scenarios.** Nobody owns these. Engineer would default-own but PM has the acceptance criteria. → Recommend: engineer drafts the test plan from PM's acceptance criteria, PM signs off.
5. **Performance budgets** (gallery render at 5k+ cards, ingest throughput, image-cache hit rate). No owner. → Recommend: engineer.
6. **Data-ingest correctness audit** (did Scryfall sync drop rows? Did `set_updated_at` fire on every update?). No owner — could split between engineer (mechanism) and MTG-expert (data correctness). → Recommend: engineer for mechanism, MTG-expert sign-off on sampling.
7. **Backups, hosting, deployment** (deferred to Phase 7 per DECISIONS.md). Nobody owns yet — fine for now.
8. **Legal / IP review** (the "MTG-adjacent, legally distinct" promise). Brand and MTG-expert both reference WotC IP; in practice if a PR contains a phrase like "Planeswalker" or a mana-pip glyph, who catches it? → Recommend: a `tutor-wotc-ip-scan` skill plus shared ownership across brand + MTG-expert.

## 8. Gaps (Missing Agents/Skills)

**Missing agents** — and whether they are actually needed at this phase:

| Candidate | Need now? | Rationale |
|---|---|---|
| `tutor-qa` (test scenarios + Playwright + Vitest discipline) | **Yes, P1** | Nobody owns test plans today; this is the single most-likely-to-decay area as phases compound. |
| `tutor-data-ingest` (Scryfall sync correctness, scheduled tasks) | Not yet | Engineer owns it through Phase 6; revisit if ingest grows beyond `make ingest-all`. |
| `tutor-release` (CHANGELOG, version, deploy) | No, Phase 7 | Hosting deferred; defer agent too. |
| `tutor-security` (input validation, SQL-injection review, secrets) | No | Single-user, no auth in V1. Revisit at multi-user phase. |
| `tutor-content-writer` (KB seed content, archetype write-ups) | Not yet | V1.3+ work; defer to roadmap. |

**Missing skills** (project-scoped under `.claude/skills/`):

| Skill | Why needed |
|---|---|
| `tutor-scryfall-fetch` | Encodes rate-limit (50–100ms), User-Agent, retry, bulk-data preference, attribution. Repetitive prose today. |
| `tutor-decision-log` | Append a properly shaped entry; reduce drift in `DECISIONS.md` format. |
| `tutor-phase-handoff` | Codify plan→approval→implement→verify with templates. |
| `tutor-openapi-sync` | Run `make codegen`, diff `schema.ts`, surface breaking changes. |
| `tutor-migration-new` | SQLx migration scaffold with `set_updated_at` trigger by default. |
| `tutor-token-audit` | WCAG AA contrast across every token pair. Brand requires it but nothing automates it. |
| `tutor-wotc-ip-scan` | Grep diffs for forbidden trademarks/mana symbols/copyrighted art keywords. |

**Missing hooks** (under `.claude/hooks/`):

- `PreCommit`/`PreToolUse(Bash:git commit)` — block commits that don't follow `feat|fix|chore|spec(<scope>): <subject>`.
- `PostToolUse(Edit:**/migrations/*.sql)` — remind to add a corresponding `set_updated_at` trigger.
- `PostToolUse(Edit:api/src/handlers/**)` — remind to run `make codegen` after handler changes.
- `SessionStart` — print phase status from `DECISIONS.md` and `git log`.

**Missing settings**:

- `.claude/settings.json` permission allow-list for: `cargo build|test|fmt|clippy|run`, `pnpm dev|build|test|lint|typecheck`, `sqlx migrate`, `make *`, `docker compose ps|logs|up|down`.

## 9. Recommendations Backlog (Agent Setup)

Each item: **Title** — Why — Priority — Effort.

1. **Add project-scoped `CLAUDE.md`** — Declare Tutor stack (Rust + plain React + SQLx + Axum + Postgres), commit message format (`feat(<scope>): Phase N — ...`), `DECISIONS.md` entry shape, "never reuse WotC IP" guardrail, and explicitly note the parent's TypeScript-specific patterns do *not* apply to the Rust API. Single highest-leverage change. — **P0 / S**
2. **Add `tools:` and `model:` to each agent's frontmatter** — Scope `tutor-mtg-expert` to `Read, WebFetch, WebSearch, Grep`; `tutor-brand-design` to `Read, Write, Edit, Grep, WebFetch` (no Bash by default); `tutor-engineer` keeps full surface; `tutor-pm` to `Read, Edit, Grep, Glob`. Reduces accidental capability and gives a clean read on each agent's role. — **P0 / S**
3. **Add `.claude/settings.json` permission allow-list** — Pre-allow `cargo *`, `pnpm *`, `sqlx *`, `make *`, `docker compose ps|logs|up|down`, `git status|diff|log|add|commit`. Removes the dozens-per-session permission prompts that train users to click "allow always" reflexively. — **P0 / S**
4. **Author `tutor-decision-log` skill** — Single-command append with a templated entry (date / decision / reason / alternatives / who). Eliminates format drift. — **P1 / S**
5. **Author `tutor-scryfall-fetch` skill** — Encodes 50–100ms rate-limit pacing, descriptive User-Agent, 429-retry, bulk-data-preference rule, attribution-string injection, image-cache path convention. Stops agents re-deriving these from prose. — **P1 / M**
6. **Author `tutor-phase-handoff` skill** — Generates the phase plan template (objectives, deliverables, acceptance criteria, agent assignments, risks), prompts for user approval, marks the phase as "in flight" in a small state file, and runs the verification checklist before allowing the close-out. — **P1 / M**
7. **Author `tutor-openapi-sync` skill** — Wraps `make codegen`, diffs `web/src/lib/api/schema.ts`, summarizes breaking client-side changes. Avoids drift between Rust handlers and the TS client. — **P1 / S**
8. **Author `tutor-migration-new` skill** — Scaffolds a new SQLx migration including the `set_updated_at` trigger registration where appropriate; reminds about partial unique indexes when multi-user lands. — **P1 / S**
9. **Author `tutor-token-audit` skill** — Reads `branding/tokens.css`, generates all foreground/background pairs, computes WCAG AA contrast, fails if any in-use pair is below threshold. Brand's working agreement requires this; nothing automates it today. — **P1 / S**
10. **Author `tutor-wotc-ip-scan` skill** — Grep PR diffs for a configurable list of forbidden strings (Planeswalker, WUBRG mana glyphs in unicode, frame asset filenames). Cheap insurance for the "MTG-adjacent, legally distinct" promise. — **P2 / S**
11. **Add a `tutor-qa` agent OR explicit "test plans" responsibility to `tutor-engineer`** — Today nobody owns test plans. Recommend folding it into `tutor-engineer` by adding a "Test plan ownership" subsection to that agent's working agreement; split into a dedicated agent only when Playwright coverage exceeds ~30 scenarios. — **P1 / S**
12. **Resolve five ownership ambiguities in the agent files** — OpenAPI shape (engineer owns shape, PM signs off on user-facing field names), microcopy authoring order (brand drafts → MTG validates), schema-field semantics (MTG defines, engineer implements; require a one-page semantics doc per non-Scryfall column), performance budgets (engineer), data-ingest sampling (engineer + MTG sign-off). Bake into each agent's "How you work with the other agents" section. — **P2 / S**
13. **Add a phase-status file** (`PHASES.md` or `.claude/state/phases.json`) — A single enumerated list of phases with status (`planned | in-flight | done`), owner agent, and link to the relevant `DECISIONS.md` section. Replaces the "recent git log = phase status" archaeology. — **P2 / S**
14. **Add `.claude/hooks/` with three hooks** — (a) `PreToolUse` on `Bash:git commit` blocking malformed messages; (b) `PostToolUse` on migration edits reminding about `set_updated_at`; (c) `SessionStart` printing the current phase, last DECISIONS entry, and git log of last 5 commits. — **P2 / M**
15. **Disable or repoint the `qmd` MCP server for this project** — qmd is configured against WalletConnect collections and contributes only noise to Tutor sessions. Either disable it in `settings.local.json` or stand up a Tutor-scoped qmd index over `DECISIONS.md` + `branding/brief.md` + future KB content. — **P2 / S**
