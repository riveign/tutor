# Tutor — Brand Brief

> **Status:** Phase 1 final. Direction **C — Field Manual** is the chosen direction. Tokens, type, and component patterns track this brief.

## Voice

**Five adjectives:** *precise, knowledgeable, calm, generous, dry.*

**Anti-voice (what we never sound like):**

- Hyped / marketing-y. Tutor is a tool, not a hype machine.
- Gatekeepy. "Real players know..." is a smell.
- Overly cute. Pun-heavy MTG humor reads as tryhard.
- Lecturing. Show, don't lecture. Advice is offered, not imposed.

**Sample voice (do / don't):**

- ✅ "Your pool is short on 2-mana interaction. Three options below — the cheapest hits creatures only."
- ❌ "Looks like you need MORE REMOVAL!!1 Let's go 🔥"
- ✅ "I used the rule of 18 lands + 8 ramp for 5-color commander pools."
- ❌ "As any real Magic player knows, 5-color decks need careful mana fixing."

## Audience

Serious MTG players — sealed-league enthusiasts, Commander brewers, draft players — who already know the game and want a thinking partner. Not new players. Not collectors-as-investors.

## Positioning

> The deckbuilding companion that thinks like you do.

Tutor reasons about cards by what they *do* in a deck, not by color or type. It tells you what your pool is short on, suggests fills, and cites the rule of thumb it used — so you can disagree.

## Do / don't

- ✅ MTG-correct vocabulary (mana base, splash, payoff, enabler, finisher, fixing).
- ✅ Credit Scryfall as the data source wherever card data appears.
- ❌ Wizards of the Coast trademarks — the *M:tG* name in branding, mana symbols, color pips, card frames, in-game artwork.
- ❌ Imitate the official aesthetic — parchment textures, gothic borders, "tap" symbols, fantasy chrome.

---

## Direction C — Field Manual

**Mood:** practical, technical, like a well-thumbed reference book or a pilot's checklist. Slightly nostalgic without being twee. This is a *workshop tool*, not a marketplace.

### Palette — light theme

| Token                  | Hex       | Role                                                            |
| ---------------------- | --------- | --------------------------------------------------------------- |
| `--color-surface`      | `#F1ECDE` | Cream paper — primary canvas                                    |
| `--color-surface-raised` | `#F8F4E8` | Cards, panels, raised surfaces                                  |
| `--color-surface-sunken` | `#E6DFCB` | Wells, code blocks, table headers                               |
| `--color-fg`           | `#2A2A2A` | Graphite ink — primary text                                     |
| `--color-fg-muted`     | `#6A6A65` | Secondary text                                                  |
| `--color-fg-subtle`    | `#8A8A82` | Tertiary, labels, captions                                      |
| `--color-border`       | `#D4CDB6` | Standard borders                                                |
| `--color-border-strong` | `#A89F84` | Emphasis borders, table outlines                                |
| `--color-accent`       | `#5F7A3C` | Working green — primary actions, "go"                           |
| `--color-accent-fg`    | `#FAFAF7` | On-accent text                                                  |
| `--color-success`      | `#5F7A3C` | Same as accent — green carries the "good" semantic              |
| `--color-warning`      | `#B07E26` | Amber for "needs attention"                                     |
| `--color-danger`       | `#9E3B3B` | Working red — destructive, "stop"                               |
| `--color-info`         | `#4A6A82` | Steel blue — neutral informational                              |

### Palette — dark theme

Derived from the same contract. Cream becomes graphite; ink becomes bone.

| Token                  | Hex       | Role                                       |
| ---------------------- | --------- | ------------------------------------------ |
| `--color-surface`      | `#1B1A17` | Graphite background                        |
| `--color-surface-raised` | `#23211D` | Raised cards                               |
| `--color-surface-sunken` | `#141311` | Wells                                      |
| `--color-fg`           | `#EDE6D2` | Bone ink                                   |
| `--color-fg-muted`     | `#A8A294` | Secondary                                  |
| `--color-fg-subtle`    | `#777264` | Tertiary                                   |
| `--color-border`       | `#3A3731` | Standard                                   |
| `--color-border-strong` | `#5A5448` | Emphasis                                   |
| `--color-accent`       | `#A4C273` | Lifted working green for contrast on dark  |
| `--color-accent-fg`    | `#161613` | On-accent text                             |
| `--color-warning`      | `#D9A24A` | Lifted amber                               |
| `--color-danger`       | `#D87474` | Lifted working red                         |
| `--color-info`         | `#86A4C4` | Lifted steel blue                          |

The greens, reds, ambers, and steel-blues are deliberately desaturated and shifted **outside** MTG's WUBRG palette so they don't collide with color-identity semantics in the UI. WUBRG colors will get their own dedicated tokens (`--color-mana-w`, etc.) when needed, used only in mana-cost or color-identity displays.

### Type

- **Display:** Roboto Slab — slab serif, technical reference. Weights 400/500/700.
- **Body:** Inter — humanist sans, optimized for screen. Weights 400/500/600.
- **Mono:** JetBrains Mono — code, card data tables, mana costs, card numbers. Weights 400/600.

Numerals: tabular figures everywhere card data is shown (`font-variant-numeric: tabular-nums`).

### Iconography

- Single-weight (1.5px) line icons; technical-drawing posture, not playful.
- Hand-drawn arrows allowed only for tutorial overlays — drawn deliberately, never as decoration.
- Card backs evoked through abstract negative space — never depicted.
- No fantasy chrome. No gothic borders. No "tap" symbol references.

### Component cues

- Tables and lists are first-class — they are the brand.
- Generous tabular whitespace; rules are 1px solid `--color-border`.
- Buttons: square corners with subtle radius (`--radius`), no gradients, no shadows below `md`.
- Focus rings: 2px solid `--color-accent`, 2px offset.
- Annotations and tooltips: small caps + JetBrains Mono uppercase letterspaced labels.

---

## Directions considered, not chosen

For the decision log only:

- **Direction A — The Reading Room** (scholarly serif, ink-blue, warm paper). Strong fit for the *tutor = search the library* metaphor but read as too quiet and risked the "dusty manuscript" failure mode.
- **Direction B — Modern Brutalist Sketchbook** (Inter Tight, electric magenta, near-black). Best at scale, easiest to maintain — but the cold neutrality fought the "thinking partner" voice.

Both were strong; C wins on distinctiveness without sacrificing the calm, practical voice.
