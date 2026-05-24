-- =============================================================================
-- Card catalog: sets, oracle cards, faces (DFC/transform/split), printings.
--
-- Vocabulary:
--   "card"     = canonical oracle card (one row per unique gameplay card,
--                identified by Scryfall's oracle_id).
--   "face"     = a single side of a multi-faced card; single-face cards have one face.
--   "printing" = a specific physical printing (set + collector_number);
--                identified by Scryfall's card.id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sets
-- -----------------------------------------------------------------------------
CREATE TABLE sets (
    code            text PRIMARY KEY,
    name            text NOT NULL,
    set_type        text,
    released_at     date,
    card_count      integer,
    icon_svg_uri    text,
    scryfall_uri    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sets_set_updated_at
    BEFORE UPDATE ON sets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Cards (oracle)
--
-- One row per unique gameplay card. Identified by Scryfall's oracle_id.
-- Multi-faced cards have aggregate columns (mana_cost across all faces,
-- type_line joined with " // ", combined oracle_text); per-face detail
-- lives in card_faces.
-- -----------------------------------------------------------------------------
CREATE TABLE cards (
    oracle_id               uuid PRIMARY KEY,
    name                    text NOT NULL,
    layout                  text NOT NULL,            -- normal | transform | modal_dfc | split | adventure | ...
    mana_cost               text,                     -- e.g. "{2}{U}{B}"; combined for multi-face
    mana_value              real NOT NULL DEFAULT 0,  -- aka converted mana cost
    color_identity          text[] NOT NULL DEFAULT ARRAY[]::text[],  -- subset of {W,U,B,R,G}
    colors                  text[] NOT NULL DEFAULT ARRAY[]::text[],
    type_line               text NOT NULL,
    oracle_text             text,
    power                   text,
    toughness               text,
    loyalty                 text,
    defense                 text,
    keywords                text[] NOT NULL DEFAULT ARRAY[]::text[],
    produced_mana           text[] NOT NULL DEFAULT ARRAY[]::text[],  -- e.g. {W,U,B,R,G} for a five-color land
    legalities              jsonb NOT NULL DEFAULT '{}'::jsonb,
    edhrec_rank             integer,

    -- Tutor-derived flags. Populated by our analyzer, not by Scryfall.
    affects_board_on_cast   boolean,
    fetchable_land_types    text[] NOT NULL DEFAULT ARRAY[]::text[],   -- {Plains,Island,Swamp,Mountain,Forest} (basic land types it fetches)

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cards_name_trgm       ON cards USING gin (name gin_trgm_ops);
CREATE INDEX cards_type_line_trgm  ON cards USING gin (type_line gin_trgm_ops);
CREATE INDEX cards_color_identity  ON cards USING gin (color_identity);
CREATE INDEX cards_colors          ON cards USING gin (colors);
CREATE INDEX cards_keywords        ON cards USING gin (keywords);
CREATE INDEX cards_produced_mana   ON cards USING gin (produced_mana);

CREATE TRIGGER cards_set_updated_at
    BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Card faces
--
-- Single-face cards have exactly one row (face_index = 0).
-- Multi-face cards (transform / modal_dfc / split / adventure / flip) have one
-- row per face, ordered by face_index.
-- -----------------------------------------------------------------------------
CREATE TABLE card_faces (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    oracle_id       uuid NOT NULL REFERENCES cards(oracle_id) ON DELETE CASCADE,
    face_index      integer NOT NULL,
    name            text NOT NULL,
    mana_cost       text,
    type_line       text,
    oracle_text     text,
    power           text,
    toughness       text,
    loyalty         text,
    defense         text,
    colors          text[] NOT NULL DEFAULT ARRAY[]::text[],
    artist          text,
    flavor_text     text,
    UNIQUE (oracle_id, face_index)
);

CREATE INDEX card_faces_oracle_id ON card_faces(oracle_id);

-- -----------------------------------------------------------------------------
-- Printings
--
-- A specific physical printing of an oracle card. The primary key is
-- Scryfall's card.id (uuid). Tracks set, collector_number, frame, finishes,
-- images, prices snapshot.
-- -----------------------------------------------------------------------------
CREATE TABLE printings (
    id                  uuid PRIMARY KEY,                              -- Scryfall card.id
    oracle_id           uuid NOT NULL REFERENCES cards(oracle_id) ON DELETE CASCADE,
    set_code            text NOT NULL REFERENCES sets(code) ON DELETE RESTRICT,
    collector_number    text NOT NULL,
    rarity              text NOT NULL,
    released_at         date,
    border_color        text,
    frame               text,
    frame_effects       text[] NOT NULL DEFAULT ARRAY[]::text[],
    finishes            text[] NOT NULL DEFAULT ARRAY[]::text[],       -- {nonfoil,foil,etched,glossy,...}
    promo_types         text[] NOT NULL DEFAULT ARRAY[]::text[],
    full_art            boolean NOT NULL DEFAULT false,
    promo               boolean NOT NULL DEFAULT false,
    variation           boolean NOT NULL DEFAULT false,
    lang                text NOT NULL DEFAULT 'en',
    image_uris          jsonb NOT NULL DEFAULT '{}'::jsonb,            -- {small,normal,large,png,art_crop,border_crop}
    prices              jsonb NOT NULL DEFAULT '{}'::jsonb,            -- {usd,usd_foil,eur,tix} at last sync
    scryfall_uri        text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (set_code, collector_number, lang)
);

CREATE INDEX printings_oracle_id  ON printings(oracle_id);
CREATE INDEX printings_set_code   ON printings(set_code);
CREATE INDEX printings_released_at ON printings(released_at);

CREATE TRIGGER printings_set_updated_at
    BEFORE UPDATE ON printings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
