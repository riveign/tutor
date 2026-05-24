-- =============================================================================
-- Taxonomy: effect tags and functional roles.
--
-- These are Tutor's core domain knowledge — they let users search by what a
-- card *does* in a deck, not just by color and type. Phase 6 (tagging engine)
-- populates these tables; this migration just establishes the schema.
--
-- - effect_tag    = a fine-grained effect a card has, e.g.
--                   "removal.creature.unconditional", "ramp.land", "tutor.creature",
--                   "draw.repeatable", "protection.indestructible".
-- - functional_role = the high-level archetype role a card plays in a deck,
--                   e.g. "ramp", "removal", "win_condition", "enabler", "payoff",
--                   "card_advantage", "interaction", "land".
--
-- Both are flat tables (no parent_id hierarchy yet) — `category` on effect_tags
-- gives a soft grouping. We add hierarchy later only if we need it.
-- =============================================================================

CREATE TYPE tagging_source AS ENUM ('rule', 'manual', 'inferred', 'community');

-- -----------------------------------------------------------------------------
-- effect_tags
-- -----------------------------------------------------------------------------
CREATE TABLE effect_tags (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE,        -- e.g. "removal.creature.unconditional"
    label           text NOT NULL,               -- e.g. "Unconditional Creature Removal"
    category        text NOT NULL,               -- e.g. "removal" | "ramp" | "draw" | "tutor" | "protection" | "recursion" | "counter" | "synergy" | "win_con"
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX effect_tags_category ON effect_tags(category);

CREATE TRIGGER effect_tags_set_updated_at
    BEFORE UPDATE ON effect_tags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- functional_roles
-- -----------------------------------------------------------------------------
CREATE TABLE functional_roles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE,        -- e.g. "ramp" | "removal" | "win_condition" | "enabler" | "payoff" | "land"
    label           text NOT NULL,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER functional_roles_set_updated_at
    BEFORE UPDATE ON functional_roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- card_effect_tags  (m:n card ↔ effect_tag, qualified by source)
--
-- A card can have the same tag from multiple sources (a rule-based tagger
-- might assign "removal.creature.unconditional" with high confidence; a
-- manual override might keep it; community data might confirm it). The
-- composite primary key includes `source` so each source's assertion is
-- independently addressable.
-- -----------------------------------------------------------------------------
CREATE TABLE card_effect_tags (
    oracle_id       uuid NOT NULL REFERENCES cards(oracle_id)        ON DELETE CASCADE,
    effect_tag_id   uuid NOT NULL REFERENCES effect_tags(id)         ON DELETE CASCADE,
    source          tagging_source NOT NULL DEFAULT 'manual',
    confidence      real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (oracle_id, effect_tag_id, source)
);

CREATE INDEX card_effect_tags_effect_tag_id ON card_effect_tags(effect_tag_id);

-- -----------------------------------------------------------------------------
-- card_functional_roles  (m:n card ↔ functional_role, qualified by source)
-- -----------------------------------------------------------------------------
CREATE TABLE card_functional_roles (
    oracle_id           uuid NOT NULL REFERENCES cards(oracle_id)        ON DELETE CASCADE,
    functional_role_id  uuid NOT NULL REFERENCES functional_roles(id)    ON DELETE CASCADE,
    source              tagging_source NOT NULL DEFAULT 'manual',
    confidence          real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (oracle_id, functional_role_id, source)
);

CREATE INDEX card_functional_roles_role_id ON card_functional_roles(functional_role_id);
