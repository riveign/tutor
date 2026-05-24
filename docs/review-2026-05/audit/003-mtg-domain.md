# Tutor — MTG Domain Audit

**Auditor:** tutor-mtg-expert
**Audit date:** 2026-05-24
**Scope:** MTG domain semantics only. Code quality, brand, and roadmap are audited separately.
**Status of repo audited:** Phase 4 complete (Scryfall ingest). Phase 3 schema live (taxonomy tables exist, empty).
**Citation note:** WebFetch was unavailable in this audit session. Anything sourced from official WotC / Scryfall pages is marked **[NEEDS LIVE FETCH]** and the team should re-verify against the live URL on the date they act on the recommendation. Per the agent charter, no bracket / format rule should be hard-coded without a fetched-on-date stamp in the schema.

---

## Table of Contents

1. Executive Summary
2. Effect-Tag Taxonomy
3. Functional-Role Taxonomy
4. Archetype Templates
5. Bracket & Format Rules
6. Scryfall Data Interpretation
7. Deckbuilding Philosophy Content
8. Schema Fidelity to MTG Semantics
9. Gaps Blocking Deckbuilder UX
10. Recommendations Backlog (MTG Domain)

---

## Executive Summary

Tutor's Phase 3 schema sets up the *shape* for MTG-domain knowledge (effect_tags, functional_roles, m:n join with `source` qualifier, cards/faces/printings split) but **none of the actual domain content has been seeded yet**. Phase 4 ingests Scryfall faithfully for the fields it consumes, but drops several fields that the deckbuilder will need before V1.4 (`game_changer`, `reserved`, `all_parts`, `card_back_id`, `prints_search_uri`, per-printing `image_uris` on faces). The bracket system — which the brand voice ("Field Manual") explicitly leans on and which the agent charter calls out as a primary deliverable — is not modelled at all in the schema. There is no `brackets` table, no `bracket_rules` table, no `game_changer` flag on cards, no `kb_rule` / `archetype_template` / `philosophy_principle` table. The deck row has a free-form `archetype` text field and no `bracket` column despite `DECISIONS.md` and `tutor-pm.md` listing "bracket" as a V1 deck attribute.

**Top 5 findings**

1. **Taxonomy tables are scaffolds, not content.** `effect_tags` and `functional_roles` have zero seed data. The slugs implied by the migration comments (e.g. `removal.creature.unconditional`, `ramp.land`, `tutor.creature`) are illustrative, not authoritative. No taxonomy spec document exists in the repo.
2. **Bracket system is absent.** The DECISIONS.md V1 scope and `tutor-pm.md` both list "bracket" as a deck attribute, but the `decks` migration has no `bracket` column, no `brackets` table, and no `game_changer` modeling. The Scryfall `game_changer` field — relevant to brackets — is not deserialised.
3. **No archetype templates, no deckbuilding philosophy KB.** These are V1.3 / V1.4 deliverables per the roadmap, but no seed-content files, no `kb_*` tables, and no archetype-shape schema exist yet. The "cite the rule" promise in the brand brief has no place to draw from.
4. **Scryfall data interpretation has small but important gaps.** `produced_mana` is captured but `mana_cost` is treated as a single opaque string — there is no normalised representation of pip count, hybrid / Phyrexian / X costs, or single- vs double-pip splash analysis (a stated tutor-mtg-expert deliverable). Reversible cards are handled; `meld`, `prototype`, `mutate`, and `class` layouts work by accident (the schema's `layout text` accepts anything) but are not tested.
5. **Format coverage is implicit, not curated.** Format names live as free-form `text` on `decks.format` and as JSON keys inside `cards.legalities`. There is no canonical list, no `formats` table, no bracketing of formats (Eternal/Rotating, 60-card/100-card, singleton), no banlist provenance, no rotation-aware logic.

**Top 10 recommendations (full list in §9)**

1. Author and commit a definitive **Effect-Tag Taxonomy spec** (markdown + seed SQL) before Phase 6.
2. Author and commit a definitive **Functional-Role Taxonomy spec** with role-vs-tag distinction documented.
3. Add `brackets` and `bracket_rules` tables with `source_url` + `fetched_on` columns, populated by a versioned snapshot of the current Commander Brackets.
4. Add `game_changer boolean` to `cards` and ingest from Scryfall.
5. Add `formats` lookup table with `kind` (singleton, 60-card, rotating, eternal) and link `decks.format_id` + `legalities` to it.
6. Add `decks.bracket_id` and remove the free-form bracket idea from product docs.
7. Add **normalized mana cost** representation: pip count by color, hybrid pips, Phyrexian pips, X, generic, snow — derived once at ingest from `mana_cost`.
8. Add `card_types`, `subtypes`, `supertypes` normalised columns derived from `type_line`.
9. Define and seed **archetype templates** (aggro, midrange, control, combo, ramp, tempo, voltron, aristocrats, stax, group-hug, spellslinger, tribal, etc.) with per-format role ratios.
10. Capture the **WotC IP boundary as data**: a `mana_pip_display` token registry so the UI can render colors without ever embedding the official mana symbols.

**Next Steps**

- Lock the Effect-Tag and Functional-Role taxonomy specs in writing before Phase 6 (tagging engine) begins implementation.
- Run a live web-fetch pass for: current Commander Brackets, Reserved List, Scryfall card-object docs. Snapshot each into `kb/sources/` with `fetched_on` stamps.
- File the recommendations in §9 into the project backlog; tutor-pm sequences across V1.1 → V1.4.

---

## 1. Effect-Tag Taxonomy

### Current state

- **Schema only.** `migrations/0005_taxonomy.sql` defines `effect_tags(id, slug, label, category, description)` and `card_effect_tags(oracle_id, effect_tag_id, source, confidence, notes)` with a `tagging_source` enum (`rule | manual | inferred | community`).
- **No taxonomy spec exists** in the repo. The migration comments give *examples* of slugs (`removal.creature.unconditional`, `ramp.land`, `tutor.creature`, `draw.repeatable`, `protection.indestructible`) and *examples* of categories (`removal | ramp | draw | tutor | protection | recursion | counter | synergy | win_con`) — but no document specifies the full set, the slug-naming grammar, or which tags are auto-derivable.
- **No seed data.** `effect_tags` is empty. The tagging engine (Phase 6 per `DECISIONS.md`) cannot start until this is defined.
- **Versioning approach: implicit only.** The `source` enum lets multiple taxonomies coexist on the same card, but the *taxonomy itself* has no version column. If "ramp.land" splits into "ramp.land.basic" and "ramp.land.nonbasic" later, there is no migration story.

### Coverage assessment

The implied category set covers the major axes a deckbuilder needs (removal, ramp, draw, tutor, protection, recursion, counter, synergy, win_con) but is **missing several axes** that come up in actual deck analysis:

- **Disruption / hate** (graveyard hate, artifact/enchantment hate, hand attack)
- **Resilience / interaction with removal** (indestructible enabler, hexproof grant, shroud)
- **Sac outlet / treasure / token generation** (deeply payoff-relevant)
- **Cost reduction** (often the difference between "playable" and "broken")
- **Mana sink** ({X} costs, activated abilities that scale)
- **Tutor sub-axes** (tutor to hand vs. battlefield vs. top of library, restriction by CMC / type / name)
- **Card-advantage sub-axes** (cantrip, repeatable draw, looting/rummaging, impulse draw / exile-and-cast)
- **Combo / engine** (sac engine, untap engine, blink engine, copy spell)
- **Triggered-ability shape** (ETB, LTB, attacks, dies, cast, landfall, constellation, prowess)
- **Restrictions / lock-pieces** (taxes, stax, prison, MLD partial)

### Issues

- The category list in the migration comment is **soft documentation**. It is not enforced as an enum or a FK; the `category` column is plain `text`. There is no guarantee taggers will use consistent categories without a written spec.
- The slug naming convention is **implicit**. Are slugs dot-namespaced (`removal.creature.unconditional`) or dash-namespaced (`removal-creature-unconditional`)? The comment shows dotted, but nothing enforces it.
- The `card_effect_tags.source` PK design is **correct**: lets rule-based + manual + community coexist. But there is no documented conflict-resolution policy ("if `manual` disagrees with `rule`, which wins?").
- **No `display_order` column** on `effect_tags`. The deckbuilder UI will want a curated sort order (e.g. removal categories before synergy categories).

---

## 2. Functional-Role Taxonomy

### Current state

- **Schema only.** `functional_roles(id, slug, label, description)` and `card_functional_roles(oracle_id, functional_role_id, source, confidence, notes)`.
- **Implied role set** from the migration comment: `ramp | removal | win_condition | enabler | payoff | card_advantage | interaction | land`. Plus `tutor-mtg-expert.md` adds: `disruption | finisher | fixing | lock-piece`.
- **No spec, no seed data.**

### Role vs. Tag distinction — undefined

The agent charter says the expert decides "what's a role vs. a tag," but there is no document recording the decision. The schema makes a structural distinction (separate tables, presumably 1–3 roles per card vs. many tags per card) but no semantic distinction is written down. The likely intent:

- **Role** = high-level archetype slot in a deck (a card fills 1–2 roles).
- **Tag** = fine-grained effect (a card may have 5+ tags).

This needs to be made explicit, with examples (e.g. *Sol Ring* has role `ramp` + tag `ramp.fast-mana.unconditional`; *Cyclonic Rift* has role `removal` + tags `removal.boardwide`, `removal.bounce`, `removal.asymmetric`).

### Mapping to archetypes — missing

No data structure connects `functional_roles` to archetypes. The future deckbuilding engine will need this: "an aggro deck wants ~15 creature-payoffs, ~10 enablers, ~5 reach, ~22 lands" requires a per-archetype role-ratio target table.

### Issues

- **Role overlap is unaddressed.** Many cards legitimately fill two roles (a planeswalker that ramps and draws; a creature that is both finisher and removal). The m:n table allows this but the deckbuilder needs to know how to count them (full credit, half credit, primary-role-only).
- **No `display_order`, no `color` token, no `icon` slug** — the UI will want these for filter chips.

---

## 3. Archetype Templates

### Current state

- **Nothing exists yet.** `decks.archetype` is a single free-form `text` column. There is no `archetypes` table, no `archetype_role_ratios` table, no per-format template.
- The DECISIONS.md log calls archetype templates a V1.3+ KB-seeding deliverable. That is reasonable — but the schema is *meant* to be present in V1 per the project policy ("schema is cheap to design once; backfilling later hurts"), and it's currently absent.

### What's needed

- An **archetype catalog** with canonical entries: `aggro`, `midrange`, `control`, `tempo`, `combo`, `ramp`, `voltron`, `aristocrats`, `tokens`, `spellslinger`, `tribal`, `reanimator`, `lands`, `stax`, `group-hug`, `superfriends`, `landfall`, `enchantress`, `equipment-voltron`, `+1/+1-counters`, etc.
- A **format ↔ archetype applicability** join (some archetypes only exist in Commander; some don't exist in 60-card formats).
- A **role-ratio target table** keyed `(archetype_id, format_id, role_id, target_min, target_max, target_typical)`.
- A **curve target table** keyed `(archetype_id, format_id, mv, target_percentage)`.
- A **mana-base rule** table for archetype × format × color-count.

### Issues

- Without archetype templates the V1 promise — "Decks CRUD: name, format, **bracket**, add/remove" — is incomplete; `archetype` as free-form text means the future deckbuilder cannot key off it deterministically.

---

## 4. Bracket & Format Rules

### Current state

**Bracket: nothing.** The word "bracket" appears in `DECISIONS.md` (V1 scope), `tutor-pm.md`, `tutor-mtg-expert.md`, and the README — but it is not in any migration, not on any table, not in any Rust type. The `decks` table has no `bracket_id` or `bracket` column.

**Formats: implicit only.**

- `decks.format` is free-form `text` with a comment listing the candidate values (commander | modern | pioneer | standard | brawl | pauper | legacy | vintage | draft | sealed | other).
- `cards.legalities` is a `jsonb` blob copied wholesale from Scryfall.
- The cards search endpoint filters with `c.legalities ->> $format = 'legal'` — string-keyed, no validation that the format string is a known one.

### Issues

- **Format names diverge from Scryfall.** Scryfall's legality keys include `historic`, `timeless`, `alchemy`, `explorer`, `oathbreaker`, `paupercommander`, `duel`, `predh`, `gladiator`, `penny`, `premodern`, `oldschool` (per the live Scryfall docs **[NEEDS LIVE FETCH]**). The DECISIONS.md candidate list misses most of these. The free-text column means any typo silently un-filters.
- **No bracket data.** The Commander Brackets system (introduced by WotC for the Commander format) is the explicit motivating example for the "rule with source URL + fetched-on date" pattern in `tutor-mtg-expert.md`. None of it is wired in. **[NEEDS LIVE FETCH from `magic.wizards.com/.../commander-brackets-beta` — last known structure: tiers 1 (Exhibition) through 5 (cEDH), with a "Game Changers" list and rules around mass land destruction, fast mana, tutors, infinite combos, and two-card infinites. Treat the structure as TBD until the team fetches.]**
- **No `game_changer` flag.** Scryfall exposes a `game_changer: boolean` on cards (per the Brackets work) **[NEEDS LIVE FETCH from `scryfall.com/docs/api/cards`]**. The Rust `ScryfallCard` struct does not deserialise it; the `cards` table does not store it.
- **No `reserved` flag.** The WotC Reserved List affects what cards a user might own / what cards a budget personality would suggest. Scryfall exposes `reserved: boolean`. Not ingested.
- **No banlist provenance.** Legalities are taken as-is from Scryfall; there is no `fetched_on` stamp on `cards.legalities`, so the team cannot answer "when did we last refresh this banlist?".
- **No `content_warning` flag.** Scryfall exposes this on some cards. Worth at least ingesting so the UI can default-hide.

---

## 5. Scryfall Data Interpretation

### What's correctly modeled

- **Oracle vs. printing split.** Correct. `cards` is keyed by `oracle_id`, `printings` by Scryfall `card.id`.
- **Reversible-card oracle resolution.** `ScryfallCard::resolved_oracle_id()` correctly falls back to the first face's `oracle_id` when the top-level field is absent. Good catch — reversible-card layouts are a known footgun.
- **type_line resolution.** Falls back to joining face type lines for MDFCs that don't carry a top-level type. Reasonable.
- **`produced_mana` array** — captured. Good; this is the single most important field for mana-base reasoning.
- **`keywords` array** — captured. Good.
- **`color_identity` vs `colors`** — distinct columns. Correct.
- **`finishes` array** — captured per printing. Correct.
- **`image_uris` and `prices` as JSONB.** Pragmatic — Scryfall mutates these.

### Gaps and risks

| Scryfall field | Status | Why it matters |
| --- | --- | --- |
| `game_changer` | **Not ingested** | Required for Commander Brackets classification. |
| `reserved` | **Not ingested** | Reserved-list cards are budget-bucketed differently. |
| `all_parts` / related cards | **Not ingested** | Required for tokens, melded cards, attractions, contraptions, dungeon room references, host/augment, and Saga-creator references. |
| `card_back_id` | Not ingested | Required to detect "reversible" pairs that share neither face. |
| `prints_search_uri` | Not ingested | Useful for "all printings of this card" UX without re-querying. |
| `oracle_id` on faces (reversible) | Handled in code, not stored on the face row | If a reversible card has two distinct oracle_ids, only one is preserved. |
| `mana_cost` per face | Captured | Good, but no normalisation (see §7). |
| `image_uris` per face | **Not captured on `card_faces`** | DFC/transform cards need per-face image URIs to render both sides in the UI. |
| `content_warning` | Not ingested | Default-hide UX. |
| `security_stamp` | Not ingested | Authentication-tool feature, low priority. |
| `arena_id` / `mtgo_id` / `tcgplayer_id` / `cardmarket_id` | Not ingested | Cross-system linking. Low priority for V1. |
| `lang` on oracle | Always English by ingest design | Documented; multi-language is post-V1. |
| `set_uri`, `scryfall_set_uri` | Not on `sets` | Low priority. |
| `digital` boolean | Not ingested | Distinguishes paper-only sets from Alchemy/Arena-only — *important* for "what can I actually play in paper Commander" queries. |
| `games` array (`paper`, `arena`, `mtgo`) | Not on `printings` | Same as above. |
| `frame_effects` | Captured | Good. |
| `promo_types` | Captured | Good. |
| `watermark` per printing | Not captured | Faction/guild watermarks are useful for tribal/faction archetypes. |
| `flavor_name` | Not captured | "Universes Beyond" cards have alternative flavor names. |
| `hand_modifier` / `life_modifier` | Not captured | Vanguard layout; obscure but legal in some formats. |
| `power` / `toughness` / `loyalty` as text | Stored as text | Correct — `*`, `1+*`, `X` exist. |
| `defense` (battles) | Captured | Good. |
| `released_at` on card vs. printing | Only on printing | Correct (oracle cards don't have a release date). |

### Layout coverage

`cards.layout` is `text` — accepts anything. Scryfall layouts I'd expect to verify against fixtures (currently only `normal` and `transform` are in the fixtures):

- `normal`, `split`, `flip`, `transform`, `modal_dfc`, `meld`, `leveler`, `class`, `case`, `saga`, `adventure`, `mutate`, `prototype`, `battle`, `planar`, `scheme`, `vanguard`, `token`, `double_faced_token`, `emblem`, `augment`, `host`, `art_series`, `reversible_card`.

The ingest code path correctly handles single-face vs. multi-face. But there are no tests for `meld` (which has three oracle cards — front A, front B, back C), `adventure` (one card, two casts), `mutate` (stack of creatures), or `prototype` (two casting modes). The handling will mostly work because of the JSONB / text-array flexibility, but the *semantic* model (e.g. "is the Adventure side castable as a separate spell?") is not encoded.

### Mana cost handling

`mana_cost` is stored as the raw Scryfall string (e.g. `{2}{U/B}{U/B}`). This is correct for round-tripping but **inadequate for deckbuilder reasoning**:

- No normalised pip count by color.
- No distinction between single-pip and double-pip splashes (a tutor-mtg-expert deliverable per the charter).
- Hybrid `{W/U}`, Phyrexian `{U/P}`, twobrid `{2/W}`, snow `{S}`, and X costs are not surfaced as flags.
- No "true CMC vs. MV at cast time" semantics for cards with alternate costs.

---

## 6. Deckbuilding Philosophy Content

### Current state

**Nothing exists.** The brand brief gestures at the philosophy ("Tutor reasons about cards by what they *do* in a deck"; example voice line "I used the rule of 18 lands + 8 ramp for 5-color commander pools") but there is no `kb/` directory, no `philosophy/` directory, no rules-as-data table, no markdown corpus.

The DECISIONS.md V1.3 milestone explicitly says "KB seeding from web research" and V1.4 "deckbuilding engine that cites KB rules" — these are sequenced for later, but the *schema for them* should already be present per the project's own policy ("schema is cheap to design once; backfilling later hurts"). It is not.

### What's needed (V1 schema, V1.3 content)

A `kb_rules` table keyed by a stable slug, with: `title`, `summary`, `body`, `category` (mana-base, role-ratio, curve, splash, archetype-construction, …), `applies_to_format[]`, `applies_to_archetype[]`, `source_url`, `fetched_on`, `confidence`. The "cite the rule" UX needs the source URL field populated.

Sample seed entries the team will eventually want:

- "Every card should affect the board, draw a card, or fix mana" (general principle).
- "Single-pip splash" (mana-base).
- "Rule of 18 lands + 8 ramp in 5-color Commander" (the line already in the brand brief).
- "Karsten land-count formula" — well-known web-source.
- "8–10 ramp pieces in Commander" — well-known web-source.
- "10–12 card draw pieces in Commander" — well-known web-source.
- "10 interaction pieces in Commander" — well-known web-source.

All of these need **citation** in the schema, per the agent charter.

---

## 7. Schema Fidelity to MTG Semantics

### Strengths

- Oracle / face / printing split is correct.
- `color_identity` array (vs. `colors`) is correctly separated.
- `produced_mana` is captured and indexed (GIN). This is the right way to power "which lands produce U?" queries.
- `legalities` as JSONB is pragmatic given Scryfall's evolving format list.
- `tagging_source` enum with `source` in the PK lets multiple taggers coexist.
- `pg_trgm` for name/type search is the right call for V1.

### Weaknesses (MTG-semantics specific)

1. **No normalised mana cost.** Discussed in §5. Add columns for `pip_count_w/u/b/r/g/c`, `pip_count_hybrid_*`, `pip_count_phyrexian_*`, `pip_count_generic`, `pip_count_x`, `pip_count_snow`, `has_alternate_cost`. Derive at ingest.
2. **No normalised type line.** `type_line` is a single string with " — " separating types from subtypes and " // " separating faces. The deckbuilder will want: `card_types text[]` (Creature, Artifact, Sorcery, …), `card_supertypes text[]` (Legendary, Basic, Snow, World, Ongoing), `card_subtypes text[]` (Goblin, Equipment, Aura, …).
3. **No `is_basic_land`, `is_snow`, `is_legendary` derived flags.** All inferrable from `type_line`, but every query that needs them currently has to LIKE-match.
4. **`fetchable_land_types` is on the *card* row** — but fetching is a property of the *card that fetches*, not the *land that is fetchable*. The naming reads as "this is which basics this fetchland fetches"; the comment confirms that. Re-name to `fetches_land_types` or `fetch_targets` to avoid confusion. The current name reads as "land types this card can be fetched by."
5. **`affects_board_on_cast` is a `boolean`** — but it really wants three values: yes / no / null-unknown. The schema uses nullable boolean which is correct in SQL but worth a check that the tagger writes `NULL` for un-analysed cards rather than `false`.
6. **No `card_relationships` table.** Required for: token producers ↔ tokens, meld pairs, host/augment pairs, attraction sources ↔ attractions, dungeon ↔ rooms, Saga ↔ creature outputs, partner ↔ partner, friends-forever, choose-a-background pairings, doctor + companion, "Lieutenant"-style commander references. This is `all_parts` from Scryfall, plus our own additions.
7. **No `commander_validity` rules.** `decks.commander_oracle_id` and `decks.partner_oracle_id` are nullable references, but the schema can't enforce "commander must be Legendary Creature OR have 'can be your commander' text." The deckbuilder will need this — start with a derived `is_valid_commander boolean` on `cards` populated by the analyser.
8. **No `enters_tapped` flag.** Called out as a `CardAttributes` deliverable in `tutor-mtg-expert.md`. Required for mana-base analysis. Not in the schema.
9. **`decks.bracket` not modelled.** Discussed in §4.
10. **`decks` has no `power_level` / `bracket_id` / `commander_format_variant`** (e.g. Brawl vs. Standard Brawl vs. Pioneer Brawl vs. Historic Brawl). Free text on `format` papers over this.
11. **Reversible cards: two `oracle_id`s, one row.** If a reversible card has distinct oracle_ids per face, the current code picks the first face's oracle_id. The second oracle_id is silently dropped. For reversible cards specifically the gameplay-identity is per-face — this needs a decision.
12. **Adventure cards.** One oracle card, two castable halves. The face rows capture both, but the deckbuilder will want a flag `has_adventure boolean` (or, more generally, `castable_modes int`) so it can reason about "this is a two-for-one cantrip + creature".
13. **`mana_value real` vs `text power/toughness/loyalty`.** Correct call — but a derived `mana_value_text` (for cards with `*` in cost, currently none) and a derived `mana_value_integer` (for sorting) would help UI.

### Data-quality concerns

- Bulk re-ingest **wipes and re-inserts** `card_faces` (see `import.rs:145`). Cheap and correct for V1 but means face IDs are not stable across ingest runs. If we ever FK from another table to `card_faces.id`, we'll lose those references on every re-ingest. Likely fine because no other table does — but worth a comment.
- `printings.set_code ON DELETE RESTRICT` is correct (don't orphan printings if a set vanishes from Scryfall).

---

## 8. Gaps Blocking Deckbuilder UX

In rough order of "you cannot ship without this":

1. **Effect-tag taxonomy + seed content** (V1.3 dependency).
2. **Functional-role taxonomy + seed content** (V1.3 dependency).
3. **Normalised mana cost columns** (V1.2: pip-curve chart cannot be drawn from raw `mana_cost` text).
4. **Type-line normalisation** (`card_types`, `supertypes`, `subtypes` arrays) — needed for *every* deckbuilder query.
5. **Bracket schema + Commander Brackets seed snapshot** (V1 per DECISIONS.md, currently missing).
6. **`game_changer` flag from Scryfall** (depends on #5).
7. **`enters_tapped` flag** (mana-base analysis).
8. **Archetype templates + role-ratio tables** (V1.4 dependency).
9. **`kb_rules` table with `source_url` + `fetched_on`** (V1.4 "cite the rule" feature).
10. **Mana symbol display tokens** (brand: cannot render mana costs in UI without either licensing WotC symbols, building our own neutral pip glyphs, or text-spelling). The brand brief calls for "dedicated `--color-mana-*` tokens when needed"; that's a start but the glyph problem is unsolved.
11. **`all_parts` / `card_relationships`** — required for tokens, melds, partners, hosts, attractions.
12. **Format catalog + format×archetype applicability** — to filter the deckbuilder UI.

---

## 9. Recommendations Backlog (MTG Domain)

Priority levels: **P0** = blocks the next phase as currently sequenced. **P1** = required before V1.4 (deckbuilding engine). **P2** = required for V1.2–V1.3 polish. **P3** = post-V1.

Effort: **S** ≤ 1 day, **M** 2–5 days, **L** > 1 week.

### 1. Effect-Tag Taxonomy spec document
**Why:** Phase 6 (tagging engine) cannot start without it. The migration comment is illustrative, not authoritative. Per `tutor-mtg-expert.md` charter: "Define and maintain the EffectTag taxonomy. Track which tags are auto-derivable from oracle text and which require human judgment."
**Where:** `kb/taxonomy/effect-tags.md` plus a seed-SQL migration that populates `effect_tags`.
**Phase/Priority:** V1.1 / **P0**
**Effort:** **M**

### 2. Functional-Role Taxonomy spec document
**Why:** Same as #1; plus the role-vs-tag distinction is not written down.
**Where:** `kb/taxonomy/functional-roles.md` plus seed SQL.
**Phase/Priority:** V1.1 / **P0**
**Effort:** **S**

### 3. Document role-vs-tag semantics
**Why:** The schema makes a structural distinction but the meaning is not encoded. Without it taggers will disagree on "is X a role or a tag?"
**Where:** `kb/taxonomy/role-vs-tag.md`.
**Phase/Priority:** V1.1 / **P0**
**Effort:** **S**

### 4. Add `bracket` modeling
**Why:** Listed as a V1 deck attribute in DECISIONS.md and `tutor-pm.md`. The agent charter explicitly calls this the canonical example of "rule with source URL + fetched-on date." Source: WotC Commander Brackets announcements **[NEEDS LIVE FETCH]**.
**What:** New migration `0006_brackets.sql` with `brackets`, `bracket_rules`, `bracket_rule_sources` tables; `decks.bracket_id`; `bracket_snapshots(snapshot_id, fetched_on, source_url, raw)` for archival.
**Phase/Priority:** V1 (schema), V1.1 (seed) / **P0** (schema), **P1** (content).
**Effort:** **M**

### 5. Ingest Scryfall `game_changer` boolean
**Why:** Required for bracket classification per current Scryfall card object **[NEEDS LIVE FETCH]**.
**What:** Add `game_changer boolean NOT NULL DEFAULT false` to `cards`; deserialise in `ScryfallCard`; upsert.
**Phase/Priority:** V1.1 / **P1**
**Effort:** **S**

### 6. Ingest Scryfall `reserved`, `content_warning`, `digital`, `games`
**Why:** Budget-tier UX, default-hide UX, paper-vs-digital format filtering.
**What:** Add columns; deserialise; upsert.
**Phase/Priority:** V1.1 / **P2**
**Effort:** **S**

### 7. Normalised mana cost columns
**Why:** Pip-curve charts, single-pip-splash analysis, hybrid/Phyrexian reasoning. None of this works against the raw `mana_cost` text. Charter explicitly lists this.
**What:** Add `pip_w / pip_u / pip_b / pip_r / pip_g / pip_c smallint`; `pip_hybrid / pip_phyrexian / pip_x / pip_generic / pip_snow smallint`; `has_alternate_cost boolean`. Derive at ingest with a `parse_mana_cost()` helper.
**Phase/Priority:** V1.2 / **P1**
**Effort:** **M**

### 8. Normalised type line
**Why:** Every deckbuilder query needs to filter by card-type / subtype / supertype without LIKE-matching a single text column.
**What:** Add `card_types text[]`, `supertypes text[]`, `subtypes text[]`. Derive at ingest; GIN-index.
**Phase/Priority:** V1.1 / **P1**
**Effort:** **S**

### 9. Derived flags on `cards`
**Why:** Frequent filters; computing them at query time costs more than storing them.
**What:** `is_basic_land`, `is_snow`, `is_legendary`, `is_creature`, `is_permanent`, `is_spell` (=instant|sorcery), `is_valid_commander`, `is_partner`, `enters_tapped boolean` (analyser-populated).
**Phase/Priority:** V1.1 / **P1**
**Effort:** **S** for the obvious type-derived ones; **M** including the analyser-driven `enters_tapped`.

### 10. Format catalog table
**Why:** Free-form `decks.format` allows typos; `cards.legalities` JSON keys are not validated against any canonical list.
**What:** New `formats` table with `code` (commander, modern, …), `name`, `kind` (singleton-100, standard-60, eternal, rotating, draft, sealed, casual), `deck_size_min`, `deck_size_max`, `sideboard_size_max`, `command_zone_size`, `singleton`, `paper_only`. Backfill from Scryfall's legality keys.
**Phase/Priority:** V1 / **P1**
**Effort:** **M**

### 11. `legalities` provenance
**Why:** Banlists shift. We need to be able to say "as of when?"
**What:** Add `cards.legalities_fetched_at timestamptz`; stamp from the bulk-file's `updated_at`.
**Phase/Priority:** V1.1 / **P2**
**Effort:** **S**

### 12. `card_relationships` table (all_parts)
**Why:** Tokens, melds, partners, hosts, dungeons, attractions, Saga creators — none of these queries work without a relationship graph.
**What:** New `card_relationships(card_id, related_card_id, relationship_kind, component)`. Populate from Scryfall `all_parts`.
**Phase/Priority:** V1.2 / **P2**
**Effort:** **M**

### 13. Archetype catalog + role-ratio templates
**Why:** V1.4 deckbuilder engine. Schema-first per project policy.
**What:** `archetypes` table; `archetype_format_targets(archetype_id, format_id, role_id, min, max, typical)`; `archetype_curve_targets(archetype_id, format_id, mv, percent_min, percent_max)`.
**Phase/Priority:** V1 (schema), V1.3 (content) / **P1**
**Effort:** **L**

### 14. KB rules table with citation
**Why:** "Cites which rules it used" is the brand promise. Needs a place to live.
**What:** `kb_rules(slug, title, summary, body, category, applies_to_formats[], applies_to_archetypes[], source_url, fetched_on, confidence)`.
**Phase/Priority:** V1 (schema), V1.3 (content) / **P1**
**Effort:** **M**

### 15. Per-face image URIs
**Why:** Transform / MDFC / split cards need both faces renderable. Currently `card_faces` has no `image_uris`.
**What:** Add `image_uris jsonb` to `card_faces`; populate from Scryfall `card_faces[].image_uris`.
**Phase/Priority:** V1 / **P1**
**Effort:** **S**

### 16. Reversible-card oracle_id strategy
**Why:** Reversible cards carry distinct oracle_ids per face; the current code keeps the first and drops the second. The user-facing implication: searching for the "back" oracle name will fail.
**What:** Decide: (a) store both oracle_ids on `card_faces.oracle_id` and index, (b) treat reversibles as two separate oracle rows linked by `card_relationships`, or (c) document the trade-off and accept (a). Recommend (a) — minimal change, correct semantics. Add `card_faces.oracle_id uuid` plus a search-time UNION.
**Phase/Priority:** V1.1 / **P2**
**Effort:** **S**

### 17. Layout coverage tests
**Why:** Only `normal` and `transform` are in fixtures. `meld`, `adventure`, `mutate`, `prototype`, `class`, `case`, `saga`, `battle`, `reversible_card`, `art_series`, `token`, `double_faced_token`, `emblem` are not exercised.
**What:** Extend `api/tests/fixtures/` with one example per layout (small selection of real Scryfall objects, anonymised if needed); assert ingest doesn't drop semantic fields.
**Phase/Priority:** V1.1 / **P2**
**Effort:** **M**

### 18. Rename `cards.fetchable_land_types` → `cards.fetch_targets`
**Why:** The current name reads as "what land types this card can be fetched by" rather than the intended "what land types this card fetches." Avoid future grep ambiguity.
**Phase/Priority:** V1.1 / **P3**
**Effort:** **S**

### 19. Color-pip / mana-symbol display tokens — non-WotC glyphs
**Why:** The brand brief notes `--color-mana-*` tokens "when needed." The harder problem is glyphs: WotC's mana symbols are protected; Tutor must render mana costs in the UI somehow. Need a decision: (a) text-only spellouts ("U/U/B"), (b) custom neutral pip glyphs commissioned, (c) license-acceptable third-party glyphs.
**What:** Decision doc in `kb/brand/mana-symbol-strategy.md`. Hand-off to brand-design.
**Phase/Priority:** V1.2 / **P1**
**Effort:** **S** (decision) + **M** (glyphs if option b/c).

### 20. Snapshot the current Commander Brackets, Reserved List, and Scryfall card-object docs
**Why:** Every bracket/format rule in Tutor must carry source-URL + fetched-on per charter. Start the practice now.
**What:** `kb/sources/2026-05-24-commander-brackets.md` (quoted excerpt + URL + fetched_on); `kb/sources/2026-05-24-reserved-list.md`; `kb/sources/2026-05-24-scryfall-card-object.md`. Re-fetch on each major refresh.
**Phase/Priority:** V1.1 / **P1**
**Effort:** **S** per snapshot.

---

## Closing notes for the parent orchestrator

The Phase 3 schema is well-shaped at the level it claims (collections + decks + taxonomy scaffolds) but **the MTG-domain content has not been authored yet**. The most important next move for the tutor-mtg-expert role is to *write the taxonomy specs in markdown* — exactly the deliverables the charter calls out — and check them into `kb/taxonomy/`. The schema and ingest are ready to receive them; nothing else is.

Bracket support is the highest single-feature gap relative to stated V1 scope. It is doubly important because it's the canonical "rule with source URL + fetched-on date" exemplar — getting it right shapes how every future rule (mana-base rules, role ratios, philosophy principles) is stored.

The Scryfall ingest is solid for the fields it ingests but conservatively narrow. The recommended additions in §9 (`game_changer`, `reserved`, `digital`, `games`, `all_parts`, per-face `image_uris`) are individually small and collectively unlock everything downstream.
