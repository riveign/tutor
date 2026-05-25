//! Decks CRUD + entries with zones (Phase 7).
//!
//! Schema lives in migration `0004_collections_and_decks.sql`. V1 is single-user
//! / local-first, so handlers are not authorization-gated.
//!
//! Key behaviours documented at the endpoint level:
//!   * POST `/decks/{id}/entries` collapses an existing matching entry by adding
//!     to its quantity instead of failing the unique constraint
//!     `(deck_id, oracle_id, zone)`.
//!   * PATCH `/decks/{id}/entries/{entry_id}` with `quantity = 0` deletes the
//!     entry instead of writing a 0-row (CHECK constraint forbids 0).
//!   * Changing an entry's `zone` to one that already has the same oracle is
//!     rejected with 409 Conflict rather than silently merging.
//!   * Commander validation runs when `format = 'commander'` (case-insensitive)
//!     AND `commander_oracle_id IS NOT NULL`. Partner is held to the same bar.
//!   * `decks.color_identity` is computed (union of commander + partner) and
//!     persisted on every write that touches commander_oracle_id or partner_oracle_id.

use std::collections::BTreeSet;

use anyhow::Context;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    AppState,
};

// ---------------------------------------------------------------------------
// Enums mirroring the Postgres ENUMs in 0004_collections_and_decks.sql.
// ---------------------------------------------------------------------------

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[sqlx(type_name = "deck_zone", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum DeckZone {
    #[default]
    Main,
    Side,
    Maybe,
    Command,
    Companion,
}

impl DeckZone {
    fn as_str(self) -> &'static str {
        match self {
            DeckZone::Main => "main",
            DeckZone::Side => "side",
            DeckZone::Maybe => "maybe",
            DeckZone::Command => "command",
            DeckZone::Companion => "companion",
        }
    }
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// One row in `GET /decks`. Includes a small zone-count rollup so the list page
/// can render the size of each zone without a second round-trip.
#[derive(Debug, Serialize, ToSchema)]
pub struct DeckSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub format: Option<String>,
    pub archetype: Option<String>,
    pub color_identity: Vec<String>,
    pub commander_oracle_id: Option<Uuid>,
    pub partner_oracle_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Total quantity in the `main` zone (most common at-a-glance number).
    pub main_quantity: i64,
    /// Total quantity across every zone.
    pub total_quantity: i64,
    /// Number of distinct entry rows (any zone).
    pub distinct_entries: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Deck {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub format: Option<String>,
    pub archetype: Option<String>,
    pub color_identity: Vec<String>,
    pub commander_oracle_id: Option<Uuid>,
    pub partner_oracle_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDeckBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub archetype: Option<String>,
    #[serde(default)]
    pub commander_oracle_id: Option<Uuid>,
    #[serde(default)]
    pub partner_oracle_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDeckBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub archetype: Option<String>,
    #[serde(default)]
    pub commander_oracle_id: Option<Uuid>,
    #[serde(default)]
    pub partner_oracle_id: Option<Uuid>,
}

/// A `deck_entries` row joined with the oracle card's display fields.
#[derive(Debug, Serialize, ToSchema, Clone)]
pub struct DeckEntry {
    pub id: Uuid,
    pub deck_id: Uuid,
    pub oracle_id: Uuid,
    pub oracle_name: String,
    pub printing_id: Option<Uuid>,
    /// Set code of the pinned printing, if any.
    pub set_code: Option<String>,
    /// Collector number of the pinned printing, if any.
    pub collector_number: Option<String>,
    pub zone: DeckZone,
    pub quantity: i32,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDeckEntryBody {
    pub oracle_id: Uuid,
    /// Defaults to `main` if omitted.
    #[serde(default)]
    pub zone: Option<DeckZone>,
    pub quantity: i32,
    /// Optional — pin this deck slot to a specific physical printing.
    #[serde(default)]
    pub printing_id: Option<Uuid>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDeckEntryBody {
    /// Setting `quantity = 0` deletes the row (CHECK constraint forbids 0).
    #[serde(default)]
    pub quantity: Option<i32>,
    #[serde(default)]
    pub zone: Option<DeckZone>,
    #[serde(default)]
    pub printing_id: Option<Uuid>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Entries grouped by zone. Order within each zone is by `created_at` ASC.
#[derive(Debug, Serialize, Default, ToSchema)]
pub struct EntriesByZone {
    pub main: Vec<DeckEntry>,
    pub side: Vec<DeckEntry>,
    pub maybe: Vec<DeckEntry>,
    pub command: Vec<DeckEntry>,
    pub companion: Vec<DeckEntry>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeckWithEntries {
    pub deck: Deck,
    pub entries: EntriesByZone,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/decks", get(list_decks).post(create_deck))
        .route(
            "/decks/:id",
            get(get_deck).patch(update_deck).delete(delete_deck),
        )
        .route("/decks/:id/entries", get(list_entries).post(create_entry))
        .route(
            "/decks/:id/entries/:entry_id",
            patch(update_entry).delete(delete_entry),
        )
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const MAX_NAME_LEN: usize = 200;

fn validate_name(name: &str) -> ApiResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ApiError::validation("`name` must not be empty"));
    }
    if trimmed.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::validation(format!(
            "`name` must be {MAX_NAME_LEN} characters or fewer"
        )));
    }
    Ok(())
}

fn validate_quantity_create(quantity: i32) -> ApiResult<()> {
    if quantity < 1 {
        return Err(ApiError::validation(
            "`quantity` must be a positive integer for new entries",
        ));
    }
    Ok(())
}

fn is_commander_format(format: Option<&str>) -> bool {
    format
        .map(|f| f.eq_ignore_ascii_case("commander"))
        .unwrap_or(false)
}

/// Validate that an oracle_id refers to a Legendary Creature. Used for the
/// commander and (for V1) the partner slot. We deliberately do NOT enforce the
/// real Partner keyword here — that's a richer rules check for a later phase.
async fn validate_legendary_creature(pool: &PgPool, oracle_id: Uuid, role: &str) -> ApiResult<()> {
    let row = sqlx::query("SELECT type_line FROM cards WHERE oracle_id = $1")
        .bind(oracle_id)
        .fetch_optional(pool)
        .await
        .with_context(|| format!("looking up {role} oracle card"))?;

    let Some(row) = row else {
        return Err(ApiError::validation(format!("{role}_oracle_id not found")));
    };

    let type_line: String = row.get("type_line");
    // case-insensitive contains "Legendary" + "Creature"
    let lower = type_line.to_ascii_lowercase();
    if !(lower.contains("legendary") && lower.contains("creature")) {
        return Err(ApiError::validation(format!(
            "{role} must be a Legendary Creature"
        )));
    }
    Ok(())
}

/// Compute the union color identity of (commander, partner). Returns an empty
/// vec when both are NULL.
async fn compute_color_identity(
    pool: &PgPool,
    commander: Option<Uuid>,
    partner: Option<Uuid>,
) -> ApiResult<Vec<String>> {
    let mut acc: BTreeSet<String> = BTreeSet::new();
    for oid in [commander, partner].into_iter().flatten() {
        let row = sqlx::query("SELECT color_identity FROM cards WHERE oracle_id = $1")
            .bind(oid)
            .fetch_optional(pool)
            .await
            .context("loading card color_identity")?;
        if let Some(row) = row {
            let ci: Vec<String> = row.get("color_identity");
            for c in ci {
                acc.insert(c);
            }
        }
    }
    Ok(acc.into_iter().collect())
}

// ---------------------------------------------------------------------------
// Handlers — decks
// ---------------------------------------------------------------------------

/// List every deck with main / total quantity + distinct-entry rollups.
/// Single SQL round-trip; aggregates come from a LEFT JOIN + GROUP BY.
#[utoipa::path(
    get,
    path = "/api/decks",
    responses(
        (status = 200, body = [DeckSummary])
    ),
    tag = "decks"
)]
pub async fn list_decks(State(state): State<AppState>) -> ApiResult<Json<Vec<DeckSummary>>> {
    let rows = sqlx::query(
        r#"
        SELECT d.id,
               d.name,
               d.description,
               d.format,
               d.archetype,
               d.color_identity,
               d.commander_oracle_id,
               d.partner_oracle_id,
               d.created_at,
               d.updated_at,
               COALESCE(SUM(e.quantity) FILTER (WHERE e.zone = 'main'), 0)::bigint AS main_quantity,
               COALESCE(SUM(e.quantity), 0)::bigint                                AS total_quantity,
               COALESCE(COUNT(e.id), 0)::bigint                                    AS distinct_entries
        FROM decks d
        LEFT JOIN deck_entries e ON e.deck_id = d.id
        GROUP BY d.id
        ORDER BY d.created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .context("listing decks")?;

    let summaries = rows
        .into_iter()
        .map(|row| DeckSummary {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            format: row.get("format"),
            archetype: row.get("archetype"),
            color_identity: row.get("color_identity"),
            commander_oracle_id: row.get("commander_oracle_id"),
            partner_oracle_id: row.get("partner_oracle_id"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            main_quantity: row.get("main_quantity"),
            total_quantity: row.get("total_quantity"),
            distinct_entries: row.get("distinct_entries"),
        })
        .collect();

    Ok(Json(summaries))
}

#[utoipa::path(
    post,
    path = "/api/decks",
    request_body = CreateDeckBody,
    responses(
        (status = 201, body = Deck),
        (status = 400, description = "validation error")
    ),
    tag = "decks"
)]
pub async fn create_deck(
    State(state): State<AppState>,
    Json(body): Json<CreateDeckBody>,
) -> ApiResult<(StatusCode, Json<Deck>)> {
    validate_name(&body.name)?;
    let trimmed_name = body.name.trim().to_string();

    // Commander validation only fires for commander-format decks. Partner is
    // also validated whenever it's set (same rule for V1).
    if is_commander_format(body.format.as_deref()) {
        if let Some(cmd) = body.commander_oracle_id {
            validate_legendary_creature(&state.db, cmd, "commander").await?;
        }
        if let Some(p) = body.partner_oracle_id {
            validate_legendary_creature(&state.db, p, "partner").await?;
        }
    }

    let color_identity =
        compute_color_identity(&state.db, body.commander_oracle_id, body.partner_oracle_id).await?;

    let row = sqlx::query(
        r#"
        INSERT INTO decks
            (name, description, format, archetype,
             color_identity, commander_oracle_id, partner_oracle_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, description, format, archetype, color_identity,
                  commander_oracle_id, partner_oracle_id, created_at, updated_at
        "#,
    )
    .bind(&trimmed_name)
    .bind(&body.description)
    .bind(&body.format)
    .bind(&body.archetype)
    .bind(&color_identity)
    .bind(body.commander_oracle_id)
    .bind(body.partner_oracle_id)
    .fetch_one(&state.db)
    .await
    .map_err(map_oracle_fk_error)?;

    Ok((StatusCode::CREATED, Json(row_to_deck(row))))
}

#[utoipa::path(
    get,
    path = "/api/decks/{id}",
    params(("id" = Uuid, Path,)),
    responses(
        (status = 200, body = DeckWithEntries),
        (status = 404)
    ),
    tag = "decks"
)]
pub async fn get_deck(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<DeckWithEntries>> {
    let deck = load_deck(&state.db, id).await?;
    let entries = load_entries_grouped(&state.db, id).await?;
    Ok(Json(DeckWithEntries { deck, entries }))
}

#[utoipa::path(
    patch,
    path = "/api/decks/{id}",
    params(("id" = Uuid, Path,)),
    request_body = UpdateDeckBody,
    responses(
        (status = 200, body = Deck),
        (status = 400, description = "validation error"),
        (status = 404)
    ),
    tag = "decks"
)]
pub async fn update_deck(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDeckBody>,
) -> ApiResult<Json<Deck>> {
    if let Some(name) = body.name.as_deref() {
        validate_name(name)?;
    }

    // We need the current row to know the *effective* state after the partial
    // update so commander validation and color_identity computation use the
    // right values.
    let current = load_deck(&state.db, id).await?;

    let effective_format = body.format.clone().or(current.format.clone());
    let commander_changed = body.commander_oracle_id.is_some();
    let partner_changed = body.partner_oracle_id.is_some();
    let format_changed = body.format.is_some();

    // For PATCH we treat "field present" as "set to this". Clearing to NULL
    // via PATCH is not supported in V1 (mirrors collections.rs decision).
    let effective_commander = body.commander_oracle_id.or(current.commander_oracle_id);
    let effective_partner = body.partner_oracle_id.or(current.partner_oracle_id);

    if is_commander_format(effective_format.as_deref()) {
        // Re-validate if commander/partner changed OR if format flipped TO commander.
        if commander_changed || format_changed {
            if let Some(cmd) = effective_commander {
                validate_legendary_creature(&state.db, cmd, "commander").await?;
            }
        }
        if partner_changed || format_changed {
            if let Some(p) = effective_partner {
                validate_legendary_creature(&state.db, p, "partner").await?;
            }
        }
    }

    // Recompute color_identity only when commander/partner moved.
    let new_color_identity = if commander_changed || partner_changed {
        Some(compute_color_identity(&state.db, effective_commander, effective_partner).await?)
    } else {
        None
    };

    let trimmed_name = body.name.as_deref().map(|s| s.trim().to_string());

    let updated = sqlx::query(
        r#"
        UPDATE decks
        SET name                = COALESCE($2, name),
            description         = COALESCE($3, description),
            format              = COALESCE($4, format),
            archetype           = COALESCE($5, archetype),
            commander_oracle_id = COALESCE($6, commander_oracle_id),
            partner_oracle_id   = COALESCE($7, partner_oracle_id),
            color_identity      = COALESCE($8, color_identity)
        WHERE id = $1
        RETURNING id, name, description, format, archetype, color_identity,
                  commander_oracle_id, partner_oracle_id, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(&trimmed_name)
    .bind(&body.description)
    .bind(&body.format)
    .bind(&body.archetype)
    .bind(body.commander_oracle_id)
    .bind(body.partner_oracle_id)
    .bind(new_color_identity.as_ref())
    .fetch_optional(&state.db)
    .await
    .map_err(map_oracle_fk_error)?;

    let Some(row) = updated else {
        return Err(ApiError::NotFound);
    };
    Ok(Json(row_to_deck(row)))
}

#[utoipa::path(
    delete,
    path = "/api/decks/{id}",
    params(("id" = Uuid, Path,)),
    responses(
        (status = 204, description = "deleted; cascades entries"),
        (status = 404)
    ),
    tag = "decks"
)]
pub async fn delete_deck(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let affected = sqlx::query("DELETE FROM decks WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .context("deleting deck")?
        .rows_affected();

    if affected == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Handlers — entries
// ---------------------------------------------------------------------------

/// Flat list of all entries in a deck, ordered by zone then created_at.
#[utoipa::path(
    get,
    path = "/api/decks/{id}/entries",
    params(("id" = Uuid, Path,)),
    operation_id = "list_deck_entries",
    responses(
        (status = 200, body = [DeckEntry]),
        (status = 404)
    ),
    tag = "decks"
)]
pub async fn list_entries(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Vec<DeckEntry>>> {
    ensure_deck_exists(&state.db, id).await?;
    let rows = fetch_entries_ordered(&state.db, id).await?;
    Ok(Json(rows))
}

/// Add an entry to a deck.
///
/// **Collapsing behaviour:** if a row already exists with the same
/// `(deck_id, oracle_id, zone)` tuple, the existing row's `quantity` is
/// incremented by the requested quantity instead of failing the unique
/// constraint. `printing_id` and `notes` are only overwritten when the
/// incoming value is non-null (preserves earlier pinning / annotations on
/// top-ups).
#[utoipa::path(
    post,
    path = "/api/decks/{id}/entries",
    params(("id" = Uuid, Path,)),
    request_body = CreateDeckEntryBody,
    operation_id = "create_deck_entry",
    responses(
        (status = 201, body = DeckEntry),
        (status = 400, description = "validation error"),
        (status = 404)
    ),
    tag = "decks"
)]
pub async fn create_entry(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateDeckEntryBody>,
) -> ApiResult<(StatusCode, Json<DeckEntry>)> {
    validate_quantity_create(body.quantity)?;
    ensure_deck_exists(&state.db, id).await?;

    let zone = body.zone.unwrap_or_default();

    let inserted = sqlx::query(
        r#"
        INSERT INTO deck_entries
            (deck_id, oracle_id, printing_id, zone, quantity, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (deck_id, oracle_id, zone)
        DO UPDATE SET
            quantity    = deck_entries.quantity + EXCLUDED.quantity,
            printing_id = COALESCE(EXCLUDED.printing_id, deck_entries.printing_id),
            notes       = COALESCE(EXCLUDED.notes,       deck_entries.notes)
        RETURNING id
        "#,
    )
    .bind(id)
    .bind(body.oracle_id)
    .bind(body.printing_id)
    .bind(zone)
    .bind(body.quantity)
    .bind(&body.notes)
    .fetch_one(&state.db)
    .await
    .map_err(map_entry_fk_error)?;

    let entry_id: Uuid = inserted.get("id");
    let entry = load_entry(&state.db, id, entry_id).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

/// Partial update for a deck entry.
///
/// **Delete-on-zero:** `quantity = 0` deletes the row and returns 204.
///
/// **Zone-conflict:** if `zone` is supplied and another row already exists at
/// `(deck_id, oracle_id, new_zone)`, the request is rejected with 409 rather
/// than silently merging — the user almost certainly didn't mean to lose
/// quantity data.
#[utoipa::path(
    patch,
    path = "/api/decks/{id}/entries/{entry_id}",
    params(
        ("id" = Uuid, Path,),
        ("entry_id" = Uuid, Path,),
    ),
    request_body = UpdateDeckEntryBody,
    operation_id = "update_deck_entry",
    responses(
        (status = 200, body = DeckEntry),
        (status = 204, description = "quantity was 0; entry deleted"),
        (status = 400, description = "validation error"),
        (status = 404),
        (status = 409, description = "zone change collides with existing entry")
    ),
    tag = "decks"
)]
pub async fn update_entry(
    State(state): State<AppState>,
    Path((deck_id, entry_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateDeckEntryBody>,
) -> ApiResult<axum::response::Response> {
    use axum::response::IntoResponse;

    // Delete-on-zero short-circuit (and reject negatives).
    if let Some(q) = body.quantity {
        if q == 0 {
            let affected = sqlx::query("DELETE FROM deck_entries WHERE deck_id = $1 AND id = $2")
                .bind(deck_id)
                .bind(entry_id)
                .execute(&state.db)
                .await
                .context("deleting deck entry on quantity=0")?
                .rows_affected();
            if affected == 0 {
                return Err(ApiError::NotFound);
            }
            return Ok(StatusCode::NO_CONTENT.into_response());
        }
        if q < 0 {
            return Err(ApiError::validation(
                "`quantity` must be >= 0 (use 0 to delete the entry)",
            ));
        }
    }

    // Zone-collision check (best-effort before the UPDATE — we still rely on
    // the UNIQUE constraint as backstop, mapped to a 409).
    if let Some(new_zone) = body.zone {
        let current =
            sqlx::query("SELECT oracle_id, zone FROM deck_entries WHERE deck_id = $1 AND id = $2")
                .bind(deck_id)
                .bind(entry_id)
                .fetch_optional(&state.db)
                .await
                .context("loading deck entry for zone-collision check")?;
        let Some(current) = current else {
            return Err(ApiError::NotFound);
        };
        let current_oracle: Uuid = current.get("oracle_id");
        let current_zone: DeckZone = current.get("zone");
        if new_zone != current_zone {
            let collides: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM deck_entries \
                 WHERE deck_id = $1 AND oracle_id = $2 AND zone = $3 AND id <> $4",
            )
            .bind(deck_id)
            .bind(current_oracle)
            .bind(new_zone)
            .bind(entry_id)
            .fetch_optional(&state.db)
            .await
            .context("checking zone-collision")?;
            if collides.is_some() {
                return Err(ApiError::Conflict(format!(
                    "another entry already exists for this oracle in zone `{}`",
                    new_zone.as_str()
                )));
            }
        }
    }

    let updated = sqlx::query(
        r#"
        UPDATE deck_entries
        SET quantity    = COALESCE($3, quantity),
            zone        = COALESCE($4, zone),
            printing_id = COALESCE($5, printing_id),
            notes       = COALESCE($6, notes)
        WHERE deck_id = $1 AND id = $2
        RETURNING id
        "#,
    )
    .bind(deck_id)
    .bind(entry_id)
    .bind(body.quantity)
    .bind(body.zone)
    .bind(body.printing_id)
    .bind(&body.notes)
    .fetch_optional(&state.db)
    .await
    .map_err(map_entry_fk_error)?;

    if updated.is_none() {
        return Err(ApiError::NotFound);
    }

    let entry = load_entry(&state.db, deck_id, entry_id).await?;
    Ok(Json(entry).into_response())
}

#[utoipa::path(
    delete,
    path = "/api/decks/{id}/entries/{entry_id}",
    params(
        ("id" = Uuid, Path,),
        ("entry_id" = Uuid, Path,),
    ),
    operation_id = "delete_deck_entry",
    responses(
        (status = 204),
        (status = 404)
    ),
    tag = "decks"
)]
pub async fn delete_entry(
    State(state): State<AppState>,
    Path((deck_id, entry_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let affected = sqlx::query("DELETE FROM deck_entries WHERE deck_id = $1 AND id = $2")
        .bind(deck_id)
        .bind(entry_id)
        .execute(&state.db)
        .await
        .context("deleting deck entry")?
        .rows_affected();
    if affected == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn ensure_deck_exists(pool: &PgPool, id: Uuid) -> ApiResult<()> {
    let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM decks WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .context("checking deck existence")?;
    if exists.is_none() {
        return Err(ApiError::NotFound);
    }
    Ok(())
}

async fn load_deck(pool: &PgPool, id: Uuid) -> ApiResult<Deck> {
    let row = sqlx::query(
        r#"
        SELECT id, name, description, format, archetype, color_identity,
               commander_oracle_id, partner_oracle_id, created_at, updated_at
        FROM decks
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .context("loading deck")?;

    let Some(row) = row else {
        return Err(ApiError::NotFound);
    };
    Ok(row_to_deck(row))
}

fn row_to_deck(row: sqlx::postgres::PgRow) -> Deck {
    Deck {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        format: row.get("format"),
        archetype: row.get("archetype"),
        color_identity: row.get("color_identity"),
        commander_oracle_id: row.get("commander_oracle_id"),
        partner_oracle_id: row.get("partner_oracle_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

async fn fetch_entries_ordered(pool: &PgPool, deck_id: Uuid) -> ApiResult<Vec<DeckEntry>> {
    // ORDER BY enum: cast to text and put main first via CASE, then alphabetical
    // for the rest — simple and good enough for V1. Then created_at within zone.
    let rows = sqlx::query(
        r#"
        SELECT  e.id,
                e.deck_id,
                e.oracle_id,
                c.name AS oracle_name,
                e.printing_id,
                p.set_code,
                p.collector_number,
                e.zone,
                e.quantity,
                e.notes,
                e.created_at,
                e.updated_at
        FROM deck_entries e
        JOIN cards     c ON c.oracle_id = e.oracle_id
        LEFT JOIN printings p ON p.id = e.printing_id
        WHERE e.deck_id = $1
        ORDER BY CASE e.zone
                    WHEN 'command'   THEN 0
                    WHEN 'companion' THEN 1
                    WHEN 'main'      THEN 2
                    WHEN 'side'      THEN 3
                    WHEN 'maybe'     THEN 4
                 END,
                 e.created_at ASC
        "#,
    )
    .bind(deck_id)
    .fetch_all(pool)
    .await
    .context("listing deck entries")?;

    Ok(rows.into_iter().map(row_to_entry).collect())
}

async fn load_entries_grouped(pool: &PgPool, deck_id: Uuid) -> ApiResult<EntriesByZone> {
    let entries = fetch_entries_ordered(pool, deck_id).await?;
    let mut grouped = EntriesByZone::default();
    for e in entries {
        match e.zone {
            DeckZone::Main => grouped.main.push(e),
            DeckZone::Side => grouped.side.push(e),
            DeckZone::Maybe => grouped.maybe.push(e),
            DeckZone::Command => grouped.command.push(e),
            DeckZone::Companion => grouped.companion.push(e),
        }
    }
    Ok(grouped)
}

async fn load_entry(pool: &PgPool, deck_id: Uuid, entry_id: Uuid) -> ApiResult<DeckEntry> {
    let row = sqlx::query(
        r#"
        SELECT  e.id,
                e.deck_id,
                e.oracle_id,
                c.name AS oracle_name,
                e.printing_id,
                p.set_code,
                p.collector_number,
                e.zone,
                e.quantity,
                e.notes,
                e.created_at,
                e.updated_at
        FROM deck_entries e
        JOIN cards     c ON c.oracle_id = e.oracle_id
        LEFT JOIN printings p ON p.id = e.printing_id
        WHERE e.deck_id = $1 AND e.id = $2
        "#,
    )
    .bind(deck_id)
    .bind(entry_id)
    .fetch_optional(pool)
    .await
    .context("loading deck entry")?;

    let Some(row) = row else {
        return Err(ApiError::NotFound);
    };
    Ok(row_to_entry(row))
}

fn row_to_entry(row: sqlx::postgres::PgRow) -> DeckEntry {
    DeckEntry {
        id: row.get("id"),
        deck_id: row.get("deck_id"),
        oracle_id: row.get("oracle_id"),
        oracle_name: row.get("oracle_name"),
        printing_id: row.get("printing_id"),
        set_code: row.get("set_code"),
        collector_number: row.get("collector_number"),
        zone: row.get("zone"),
        quantity: row.get("quantity"),
        notes: row.get("notes"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

/// Turn a foreign-key violation on `commander_oracle_id` / `partner_oracle_id`
/// into a 400 instead of a 500. Other database errors keep their existing path.
fn map_oracle_fk_error(err: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db_err) = &err {
        if db_err.code().as_deref() == Some("23503") {
            return ApiError::validation(format!(
                "referenced oracle card not found: {}",
                db_err.message()
            ));
        }
    }
    ApiError::Database(err)
}

/// Map FK + unique violations on deck_entries to user-meaningful errors.
fn map_entry_fk_error(err: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db_err) = &err {
        match db_err.code().as_deref() {
            Some("23503") => {
                return ApiError::validation(format!(
                    "referenced oracle or printing not found: {}",
                    db_err.message()
                ));
            }
            Some("23505") => {
                // Should be rare since POST handles ON CONFLICT, but PATCH can
                // still trip the (deck_id, oracle_id, zone) unique index on a
                // zone change.
                return ApiError::Conflict(
                    "another entry already exists for this oracle in the target zone".to_string(),
                );
            }
            _ => {}
        }
    }
    ApiError::Database(err)
}
