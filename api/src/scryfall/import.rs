//! Upsert Scryfall payloads into Postgres.
//!
//! All upserts are idempotent: re-running the ingest is safe and stamps
//! `updated_at` via the row triggers. We deliberately do not delete rows
//! that disappear from Scryfall — once a card/printing is known to Tutor
//! it stays known. (A future "prune" command could change that.)

use anyhow::{Context, Result};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::models::{ScryfallCard, ScryfallSet};

/// Chunk size for batched inserts. 500 keeps statement size well under any
/// Postgres limit and gives the progress bar smooth ticks.
const CHUNK: usize = 500;

// ============================================================================
// Sets
// ============================================================================

pub async fn upsert_sets(pool: &PgPool, sets: &[ScryfallSet]) -> Result<usize> {
    let mut tx = pool.begin().await?;
    for s in sets {
        sqlx::query(
            r#"
            INSERT INTO sets (code, name, set_type, released_at, card_count, icon_svg_uri, scryfall_uri)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (code) DO UPDATE
              SET name         = EXCLUDED.name,
                  set_type     = EXCLUDED.set_type,
                  released_at  = EXCLUDED.released_at,
                  card_count   = EXCLUDED.card_count,
                  icon_svg_uri = EXCLUDED.icon_svg_uri,
                  scryfall_uri = EXCLUDED.scryfall_uri
            "#,
        )
        .bind(&s.code)
        .bind(&s.name)
        .bind(&s.set_type)
        .bind(s.released_at)
        .bind(s.card_count)
        .bind(&s.icon_svg_uri)
        .bind(&s.scryfall_uri)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("upserting set {}", s.code))?;
    }
    tx.commit().await?;
    Ok(sets.len())
}

// ============================================================================
// Cards (oracle catalog)
//
// We accept the *oracle_cards* bulk (one entry per oracle_id, English-only,
// already a printing object) and project it down to the oracle row plus the
// card_faces rows.
// ============================================================================

pub async fn upsert_oracle_cards(pool: &PgPool, cards: &[ScryfallCard]) -> Result<usize> {
    let mut inserted = 0_usize;
    for chunk in cards.chunks(CHUNK) {
        let mut tx = pool.begin().await?;
        for c in chunk {
            let Some(oracle_id) = c.resolved_oracle_id() else {
                tracing::warn!(name = %c.name, "skipping card with no oracle_id");
                continue;
            };
            upsert_oracle_card_row(&mut tx, oracle_id, c).await?;
            upsert_card_faces(&mut tx, oracle_id, c).await?;
            inserted += 1;
        }
        tx.commit().await?;
    }
    Ok(inserted)
}

async fn upsert_oracle_card_row(
    tx: &mut Transaction<'_, Postgres>,
    oracle_id: Uuid,
    c: &ScryfallCard,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO cards (
            oracle_id, name, layout, mana_cost, mana_value,
            color_identity, colors, type_line, oracle_text,
            power, toughness, loyalty, defense,
            keywords, produced_mana, legalities, edhrec_rank
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13,
            $14, $15, $16, $17
        )
        ON CONFLICT (oracle_id) DO UPDATE
          SET name           = EXCLUDED.name,
              layout         = EXCLUDED.layout,
              mana_cost      = EXCLUDED.mana_cost,
              mana_value     = EXCLUDED.mana_value,
              color_identity = EXCLUDED.color_identity,
              colors         = EXCLUDED.colors,
              type_line      = EXCLUDED.type_line,
              oracle_text    = EXCLUDED.oracle_text,
              power          = EXCLUDED.power,
              toughness      = EXCLUDED.toughness,
              loyalty        = EXCLUDED.loyalty,
              defense        = EXCLUDED.defense,
              keywords       = EXCLUDED.keywords,
              produced_mana  = EXCLUDED.produced_mana,
              legalities     = EXCLUDED.legalities,
              edhrec_rank    = EXCLUDED.edhrec_rank
        "#,
    )
    .bind(oracle_id)
    .bind(&c.name)
    .bind(&c.layout)
    .bind(&c.mana_cost)
    .bind(c.cmc.unwrap_or(0.0))
    .bind(&c.color_identity)
    .bind(c.colors.clone().unwrap_or_default())
    .bind(c.resolved_type_line())
    .bind(&c.oracle_text)
    .bind(&c.power)
    .bind(&c.toughness)
    .bind(&c.loyalty)
    .bind(&c.defense)
    .bind(&c.keywords)
    .bind(c.produced_mana.clone().unwrap_or_default())
    .bind(&c.legalities)
    .bind(c.edhrec_rank)
    .execute(&mut **tx)
    .await
    .with_context(|| format!("upserting card {} ({oracle_id})", c.name))?;
    Ok(())
}

async fn upsert_card_faces(
    tx: &mut Transaction<'_, Postgres>,
    oracle_id: Uuid,
    c: &ScryfallCard,
) -> Result<()> {
    // Wipe and re-insert faces. Cheap (<= 5 rows per card), keeps logic simple.
    sqlx::query("DELETE FROM card_faces WHERE oracle_id = $1")
        .bind(oracle_id)
        .execute(&mut **tx)
        .await?;

    if c.card_faces.is_empty() {
        // Single-face card — synthesize one face row.
        sqlx::query(
            r#"
            INSERT INTO card_faces (
                oracle_id, face_index, name, mana_cost, type_line, oracle_text,
                power, toughness, loyalty, defense, colors, artist, flavor_text
            ) VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL)
            "#,
        )
        .bind(oracle_id)
        .bind(&c.name)
        .bind(&c.mana_cost)
        .bind(c.resolved_type_line())
        .bind(&c.oracle_text)
        .bind(&c.power)
        .bind(&c.toughness)
        .bind(&c.loyalty)
        .bind(&c.defense)
        .bind(c.colors.clone().unwrap_or_default())
        .execute(&mut **tx)
        .await?;
    } else {
        for (i, f) in c.card_faces.iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO card_faces (
                    oracle_id, face_index, name, mana_cost, type_line, oracle_text,
                    power, toughness, loyalty, defense, colors, artist, flavor_text
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                "#,
            )
            .bind(oracle_id)
            .bind(i as i32)
            .bind(&f.name)
            .bind(&f.mana_cost)
            .bind(&f.type_line)
            .bind(&f.oracle_text)
            .bind(&f.power)
            .bind(&f.toughness)
            .bind(&f.loyalty)
            .bind(&f.defense)
            .bind(f.colors.clone().unwrap_or_default())
            .bind(&f.artist)
            .bind(&f.flavor_text)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

// ============================================================================
// Printings (from default_cards bulk)
//
// `default_cards` returns one Scryfall card object per printing. We must
// have a row in `cards` for its oracle_id and a row in `sets` for its set
// code before we can insert.
// ============================================================================

pub async fn upsert_printings(pool: &PgPool, cards: &[ScryfallCard]) -> Result<usize> {
    let mut inserted = 0_usize;
    let mut skipped_missing_oracle = 0_usize;

    for chunk in cards.chunks(CHUNK) {
        let mut tx = pool.begin().await?;
        for c in chunk {
            let Some(oracle_id) = c.resolved_oracle_id() else {
                skipped_missing_oracle += 1;
                continue;
            };
            sqlx::query(
                r#"
                INSERT INTO printings (
                    id, oracle_id, set_code, collector_number, rarity,
                    released_at, border_color, frame, frame_effects, finishes,
                    promo_types, full_art, promo, variation, lang,
                    image_uris, prices, scryfall_uri
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15,
                    $16, $17, $18
                )
                ON CONFLICT (id) DO UPDATE
                  SET oracle_id        = EXCLUDED.oracle_id,
                      set_code         = EXCLUDED.set_code,
                      collector_number = EXCLUDED.collector_number,
                      rarity           = EXCLUDED.rarity,
                      released_at      = EXCLUDED.released_at,
                      border_color     = EXCLUDED.border_color,
                      frame            = EXCLUDED.frame,
                      frame_effects    = EXCLUDED.frame_effects,
                      finishes         = EXCLUDED.finishes,
                      promo_types      = EXCLUDED.promo_types,
                      full_art         = EXCLUDED.full_art,
                      promo            = EXCLUDED.promo,
                      variation        = EXCLUDED.variation,
                      lang             = EXCLUDED.lang,
                      image_uris       = EXCLUDED.image_uris,
                      prices           = EXCLUDED.prices,
                      scryfall_uri     = EXCLUDED.scryfall_uri
                "#,
            )
            .bind(c.id)
            .bind(oracle_id)
            .bind(&c.set)
            .bind(&c.collector_number)
            .bind(&c.rarity)
            .bind(c.released_at)
            .bind(&c.border_color)
            .bind(&c.frame)
            .bind(&c.frame_effects)
            .bind(&c.finishes)
            .bind(&c.promo_types)
            .bind(c.full_art)
            .bind(c.promo)
            .bind(c.variation)
            .bind(&c.lang)
            .bind(&c.image_uris)
            .bind(&c.prices)
            .bind(&c.scryfall_uri)
            .execute(&mut *tx)
            .await
            .with_context(|| {
                format!(
                    "upserting printing {} ({} #{})",
                    c.id, c.set, c.collector_number
                )
            })?;
            inserted += 1;
        }
        tx.commit().await?;
    }

    if skipped_missing_oracle > 0 {
        tracing::warn!(
            count = skipped_missing_oracle,
            "skipped printings with no resolvable oracle_id"
        );
    }
    Ok(inserted)
}
