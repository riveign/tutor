-- Extensions used by the data model.
--   pgcrypto — gen_random_uuid() for surrogate primary keys
--   pg_trgm  — trigram GIN indexes on text columns (card name / type line search)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Reusable trigger function: stamp updated_at on every row update.
-- Attach with: CREATE TRIGGER <name> BEFORE UPDATE ON <table>
--              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
