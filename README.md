# Tutor

The ultimate collection manager and deckbuilding companion for Magic: The Gathering players.

## Status

Pre-scaffold. Working through the phased setup. See [`DECISIONS.md`](./DECISIONS.md) for the decision log and [`ROADMAP.md`](./ROADMAP.md) for the V1 scope + post-V1 sequencing (added in Phase 1).

## Core ideas (the differentiators)

- **Multiple physical collections** with provenance — when and how each card entered.
- **Effect/role-based search** — beyond color and type, classify cards by what they *do* in a deck.
- **Knowledge-base-as-data deckbuilding** — archetype templates, role-ratio guidelines, mana-base rules; the deckbuilder cites which rules it used.
- **Personalities** — selectable advisor profiles (Spike, Brewer, Budget, Combo, Synergy) bias recommendations.
- **Local-first**, with a clean path to production.

## Working with the project

The project uses four collaborating Claude Code agents in [`.claude/agents/`](./.claude/agents/):

- **tutor-pm** — roadmap, phase plans, scope, `DECISIONS.md`.
- **tutor-engineer** — Rust (Axum/SQLx) backend, plain React (Vite/TS/Tailwind/shadcn) frontend, Postgres, Docker, CI.
- **tutor-mtg-expert** — effect-tag and functional-role taxonomies, WotC bracket rules, deckbuilding philosophy seed content.
- **tutor-brand-design** — voice, palette, typography, logo, design tokens, UI patterns, accessibility.

Each phase runs: short plan → user approval → implement → verify.

## Trademarks

Tutor is an independent project, MTG-adjacent and legally distinct. No Wizards of the Coast trademarks, color-pip symbols, or card frames are used. Card data and images come from [Scryfall](https://scryfall.com) under Scryfall's terms.
