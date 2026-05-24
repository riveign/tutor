-- Placeholder migration. Phase 3 (data model) replaces this with the full schema.
-- Exists so sqlx::migrate! has at least one file to apply on first boot.

CREATE TABLE IF NOT EXISTS _bootstrap (
    id smallint PRIMARY KEY DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT _bootstrap_singleton CHECK (id = 1)
);

INSERT INTO _bootstrap (id) VALUES (1) ON CONFLICT DO NOTHING;
