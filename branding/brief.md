# Tutor — Brand Brief

> **Status:** Phase 1 v0 — three directions for your selection. Once you pick, this doc tightens to the chosen direction and the design tokens, logo concepts, and component patterns land.

## Voice

**Five adjectives:** *precise, knowledgeable, calm, generous, dry.*

**Anti-voice (what we never sound like):**

- Hyped / marketing-y. Tutor is a tool, not a hype machine.
- Gatekeepy. "Real players know..." is a smell.
- Overly cute. Pun-heavy MTG humor reads as tryhard.
- Lecturing. Show, don't lecture. Advice is offered, not imposed.

## Audience

Serious MTG players — sealed-league enthusiasts, Commander brewers, draft players — who already know the game and want a thinking partner. Not new players. Not collectors-as-investors.

## Positioning

> The deckbuilding companion that thinks like you do.

Tutor reasons about cards by what they *do* in a deck, not by color or type. It tells you what your pool is short on, suggests fills, and cites the rule of thumb it used — so you can disagree.

## Do / don't

- ✅ Use MTG-correct vocabulary (mana base, splash, payoff, enabler, finisher, fixing).
- ✅ Credit Scryfall as the data source wherever card data appears.
- ❌ Wizards of the Coast trademarks — the *M:tG* name in branding, Mana symbols, color pips, card frames, in-game artwork.
- ❌ Imitate the official aesthetic — parchment textures, gothic borders, "tap" symbols, fantasy chrome.

---

## Three brand directions

Each direction proposes a **mood**, a **starter palette (light theme)**, a **typographic pairing**, and an **iconography stance**. The dark theme is derived from the same token contract — pick a direction, dark comes for free.

### Direction A — *The Reading Room*

**Mood:** scholarly, library-quiet, the desk of a careful player.

**Palette (light):**
| Token | Hex | Role |
|---|---|---|
| `--color-surface` | `#F5EFE3` | Warm paper background |
| `--color-fg` | `#1F2730` | Dark slate ink |
| `--color-fg-muted` | `#5A6470` | Secondary text |
| `--color-accent` | `#1A4F7A` | Deep ink-blue (links, primary buttons) |
| `--color-signal` | `#C9892A` | Signal amber (used sparingly, for emphasis) |

**Type:** display in a humanist serif (**Source Serif 4** or **Bitter**); body in **Inter**; mono in **JetBrains Mono**.

**Iconography:** thin-line, single-weight, slight serif on terminals to match the display face. Card backs evoked through abstract negative space — never depicted.

**Why it could win:** matches the *tutor = search the library* metaphor literally. Reads as a tool you trust. Ages well.

**Risks:** can read as dusty if spacing isn't airy.

### Direction B — *Modern Brutalist Sketchbook*

**Mood:** dense information, generous whitespace where it counts, all signal no decoration.

**Palette (light):**
| Token | Hex | Role |
|---|---|---|
| `--color-surface` | `#FAFAF7` | Off-white |
| `--color-fg` | `#111111` | Near-black ink |
| `--color-fg-muted` | `#666666` | Secondary text |
| `--color-accent` | `#E91E63` | Electric magenta — deliberately outside MTG's WUBRG palette |
| `--color-signal` | `#FFB300` | Honey for "needs attention" emphasis |

Functional-role badges use muted neutrals (slate, sand, moss) — color is information, not decoration.

**Type:** display + body in **Inter Tight** (single grotesk family, weight variations carry hierarchy); mono in **JetBrains Mono**.

**Iconography:** sharp geometric, 2px stroke, no fills. Charts and badges are the visual richness — the layout *is* the brand.

**Why it could win:** scales to massive amounts of card data without fighting it. Modern. No nostalgia. Cheap to maintain.

**Risks:** can feel cold; the accent color must do a lot of work — pick it carefully.

### Direction C — *Field Manual*

**Mood:** practical, technical, like a well-thumbed reference book or pilot's checklist. Slightly nostalgic without being twee.

**Palette (light):**
| Token | Hex | Role |
|---|---|---|
| `--color-surface` | `#F1ECDE` | Cream |
| `--color-fg` | `#2A2A2A` | Graphite |
| `--color-fg-muted` | `#6A6A65` | Secondary text |
| `--color-accent` | `#5F7A3C` | Working green ("go" signals, primary actions) |
| `--color-signal` | `#9E3B3B` | Working red ("stop" signals, destructive emphasis) |

The greens and reds are deliberately desaturated and shifted **outside** MTG's WUBRG palette to avoid colliding with color-identity semantics in the UI.

**Type:** display in a slab serif (**Roboto Slab** or **JetBrains Mono Slab**); body in **Inter**; mono in **JetBrains Mono**.

**Iconography:** technical-drawing line weight; occasional sketch-style annotations as a visual signature; hand-drawn arrows for tutorial overlays.

**Why it could win:** sets Tutor apart from the slick e-commerce MTG-tools-as-marketplace category. Signals *this is a workshop tool.*

**Risks:** sketch elements must be drawn deliberately or they look amateurish.

---

## My recommendation

- **Direction A** (Reading Room) is the safest fit for the brand voice and the *tutor* name.
- **Direction C** (Field Manual) is the most distinctive.
- **Direction B** (Modern Brutalist) is the easiest to maintain at scale.

**Pick one (or a hybrid** — e.g. A's palette + B's type) and I'll land final tokens, two logo concepts, and the first wave of component patterns.

Until you pick, the codebase ships with **baseline neutral tokens** so the scaffold compiles and renders — just unsigned by a direction yet.
