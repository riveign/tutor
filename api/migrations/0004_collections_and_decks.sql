-- =============================================================================
-- User data: physical collections (with provenance) and decks (with zones).
--
-- V1 is single-user / local-first — no owner_id columns. When multi-user lands,
-- add `owner_id uuid REFERENCES users(id)` and a partial unique index per owner.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE card_finish AS ENUM ('nonfoil', 'foil', 'etched', 'glossy');
CREATE TYPE card_condition AS ENUM (
    'mint',
    'near_mint',
    'lightly_played',
    'moderately_played',
    'heavily_played',
    'damaged'
);
CREATE TYPE deck_zone AS ENUM ('main', 'side', 'maybe', 'command', 'companion');

-- -----------------------------------------------------------------------------
-- Collections
--
-- A logical pile of physical cards. Examples: "Main Binder", "Sealed Pool —
-- WOE Prerelease 2026-04", "Cube — Modern Cube", "Trade Stack".
-- -----------------------------------------------------------------------------
CREATE TABLE collections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    description     text,
    kind            text NOT NULL DEFAULT 'general',  -- general | sealed_pool | draft_pool | cube | trade_binder | bulk
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collections_kind ON collections(kind);

CREATE TRIGGER collections_set_updated_at
    BEFORE UPDATE ON collections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Collection entries
--
-- A specific printing-finish-language-condition tuple held in a collection,
-- with quantity and provenance. The unique constraint enforces that a single
-- "physical pile" of identical cards collapses to one row with a quantity
-- (not many rows of qty=1).
-- -----------------------------------------------------------------------------
CREATE TABLE collection_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id   uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    printing_id     uuid NOT NULL REFERENCES printings(id) ON DELETE RESTRICT,
    quantity        integer NOT NULL CHECK (quantity > 0),
    finish          card_finish NOT NULL DEFAULT 'nonfoil',
    language        text NOT NULL DEFAULT 'en',
    condition       card_condition NOT NULL DEFAULT 'near_mint',
    -- Provenance — when and how the card entered the collection.
    acquired_at     date,
    acquired_from   text,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (collection_id, printing_id, finish, language, condition)
);

CREATE INDEX collection_entries_collection_id ON collection_entries(collection_id);
CREATE INDEX collection_entries_printing_id   ON collection_entries(printing_id);

CREATE TRIGGER collection_entries_set_updated_at
    BEFORE UPDATE ON collection_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Decks
--
-- A virtual list of cards-by-oracle (not by printing — printing is only locked
-- when the user assigns a physical copy from a collection).
-- -----------------------------------------------------------------------------
CREATE TABLE decks (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    text NOT NULL,
    description             text,
    format                  text,                                       -- commander | modern | pioneer | standard | brawl | pauper | legacy | vintage | draft | sealed | other
    archetype               text,                                       -- free-form for now; archetype templates land in a later phase
    color_identity          text[] NOT NULL DEFAULT ARRAY[]::text[],
    commander_oracle_id     uuid REFERENCES cards(oracle_id) ON DELETE SET NULL,
    partner_oracle_id       uuid REFERENCES cards(oracle_id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX decks_format   ON decks(format);
CREATE INDEX decks_color_identity ON decks USING gin (color_identity);

CREATE TRIGGER decks_set_updated_at
    BEFORE UPDATE ON decks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Deck entries
--
-- A card in a deck. `printing_id` is nullable — when the user is brewing a
-- list before committing physical copies, the deck references oracle_ids
-- only. Once they reserve copies from a collection, the printing is set.
-- -----------------------------------------------------------------------------
CREATE TABLE deck_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deck_id         uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    oracle_id       uuid NOT NULL REFERENCES cards(oracle_id) ON DELETE RESTRICT,
    printing_id     uuid REFERENCES printings(id) ON DELETE SET NULL,
    zone            deck_zone NOT NULL DEFAULT 'main',
    quantity        integer NOT NULL CHECK (quantity > 0),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deck_id, oracle_id, zone)
);

CREATE INDEX deck_entries_deck_id     ON deck_entries(deck_id);
CREATE INDEX deck_entries_oracle_id   ON deck_entries(oracle_id);

CREATE TRIGGER deck_entries_set_updated_at
    BEFORE UPDATE ON deck_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
