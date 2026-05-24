//! Collections CRUD + entries with provenance (Phase 6).
//!
//! Schema lives in migration `0004_collections_and_decks.sql`. V1 is single-user
//! / local-first, so handlers are not authorization-gated.
//!
//! Key behaviours documented at the endpoint level:
//!   * POST `/collections/{id}/entries` collapses an existing matching entry by
//!     adding to its quantity instead of failing the unique constraint.
//!   * PATCH `/collections/{id}/entries/{entry_id}` with `quantity = 0` deletes
//!     the entry instead of writing a 0-row (the CHECK constraint forbids 0).

use anyhow::Context;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use utoipa::{IntoParams, ToSchema};
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
#[sqlx(type_name = "card_finish", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CardFinish {
    #[default]
    Nonfoil,
    Foil,
    Etched,
    Glossy,
}

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[sqlx(type_name = "card_condition", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CardCondition {
    Mint,
    #[default]
    NearMint,
    LightlyPlayed,
    ModeratelyPlayed,
    HeavilyPlayed,
    Damaged,
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// One row in the `GET /collections` list response. Counts are computed in the
/// same query that returns the collection row (single SQL round-trip per list).
#[derive(Debug, Serialize, ToSchema)]
pub struct CollectionSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub kind: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Number of distinct entry rows (each row is a printing+finish+language+condition tuple).
    pub distinct_printings: i64,
    /// Sum of `quantity` across every entry in the collection.
    pub total_quantity: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCollectionBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCollectionBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateEntryBody {
    pub printing_id: Uuid,
    pub quantity: i32,
    #[serde(default)]
    pub finish: Option<CardFinish>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub condition: Option<CardCondition>,
    #[serde(default)]
    pub acquired_at: Option<NaiveDate>,
    #[serde(default)]
    pub acquired_from: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateEntryBody {
    /// Setting `quantity = 0` deletes the row (the CHECK constraint forbids 0).
    #[serde(default)]
    pub quantity: Option<i32>,
    #[serde(default)]
    pub finish: Option<CardFinish>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub condition: Option<CardCondition>,
    #[serde(default)]
    pub acquired_at: Option<NaiveDate>,
    #[serde(default)]
    pub acquired_from: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// A `collection_entries` row joined with its printing's denormalised display
/// fields (printing name + set + collector number). Used by both the entries
/// list endpoint and create/update responses for symmetry.
#[derive(Debug, Serialize, ToSchema)]
pub struct CollectionEntry {
    pub id: Uuid,
    pub collection_id: Uuid,
    pub printing_id: Uuid,
    pub printing_name: String,
    pub set_code: String,
    pub collector_number: String,
    pub quantity: i32,
    pub finish: CardFinish,
    pub language: String,
    pub condition: CardCondition,
    pub acquired_at: Option<NaiveDate>,
    pub acquired_from: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CollectionDetail {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub kind: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub distinct_printings: i64,
    pub total_quantity: i64,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct EntriesQuery {
    /// 1-based page number. Defaults to 1.
    #[serde(default)]
    pub page: Option<i64>,
    /// Page size; defaults to 50, capped at 200.
    #[serde(default)]
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EntriesPage {
    pub items: Vec<CollectionEntry>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/collections",
            get(list_collections).post(create_collection),
        )
        .route(
            "/collections/:id",
            get(get_collection)
                .patch(update_collection)
                .delete(delete_collection),
        )
        .route(
            "/collections/:id/entries",
            get(list_entries).post(create_entry),
        )
        .route(
            "/collections/:id/entries/:entry_id",
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

// ---------------------------------------------------------------------------
// Handlers — collections
// ---------------------------------------------------------------------------

/// List every collection with its distinct-printing count and total-quantity
/// rollup. Sorted by `created_at` desc.
#[utoipa::path(
    get,
    path = "/api/collections",
    responses(
        (status = 200, body = [CollectionSummary])
    ),
    tag = "collections"
)]
pub async fn list_collections(
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<CollectionSummary>>> {
    let rows = sqlx::query(
        r#"
        SELECT c.id,
               c.name,
               c.description,
               c.kind,
               c.created_at,
               c.updated_at,
               COALESCE(COUNT(e.id), 0)::bigint           AS distinct_printings,
               COALESCE(SUM(e.quantity), 0)::bigint       AS total_quantity
        FROM collections c
        LEFT JOIN collection_entries e ON e.collection_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .context("listing collections")?;

    let summaries = rows
        .into_iter()
        .map(|row| CollectionSummary {
            id: row.get("id"),
            name: row.get("name"),
            description: row.get("description"),
            kind: row.get("kind"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            distinct_printings: row.get("distinct_printings"),
            total_quantity: row.get("total_quantity"),
        })
        .collect();

    Ok(Json(summaries))
}

#[utoipa::path(
    post,
    path = "/api/collections",
    request_body = CreateCollectionBody,
    responses(
        (status = 201, body = CollectionDetail),
        (status = 400, description = "validation error")
    ),
    tag = "collections"
)]
pub async fn create_collection(
    State(state): State<AppState>,
    Json(body): Json<CreateCollectionBody>,
) -> ApiResult<(StatusCode, Json<CollectionDetail>)> {
    validate_name(&body.name)?;
    let trimmed_name = body.name.trim().to_string();

    let row = sqlx::query(
        r#"
        INSERT INTO collections (name, description, kind)
        VALUES ($1, $2, COALESCE($3, 'general'))
        RETURNING id, name, description, kind, created_at, updated_at
        "#,
    )
    .bind(&trimmed_name)
    .bind(&body.description)
    .bind(&body.kind)
    .fetch_one(&state.db)
    .await
    .context("inserting collection")?;

    let detail = CollectionDetail {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        kind: row.get("kind"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        distinct_printings: 0,
        total_quantity: 0,
    };

    Ok((StatusCode::CREATED, Json(detail)))
}

#[utoipa::path(
    get,
    path = "/api/collections/{id}",
    params(("id" = Uuid, Path,)),
    responses(
        (status = 200, body = CollectionDetail),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn get_collection(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<CollectionDetail>> {
    let detail = load_collection(&state.db, id).await?;
    Ok(Json(detail))
}

#[utoipa::path(
    patch,
    path = "/api/collections/{id}",
    params(("id" = Uuid, Path,)),
    request_body = UpdateCollectionBody,
    responses(
        (status = 200, body = CollectionDetail),
        (status = 400, description = "validation error"),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn update_collection(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateCollectionBody>,
) -> ApiResult<Json<CollectionDetail>> {
    if let Some(name) = body.name.as_deref() {
        validate_name(name)?;
    }

    // COALESCE with the incoming value (or NULL) lets a single SQL statement
    // do partial updates without dynamic query building. Fields not present in
    // the JSON body become NULL via the Option binding and keep their existing
    // values.
    let trimmed_name = body.name.as_deref().map(|s| s.trim().to_string());

    let result = sqlx::query(
        r#"
        UPDATE collections
        SET name        = COALESCE($2, name),
            description = COALESCE($3, description),
            kind        = COALESCE($4, kind)
        WHERE id = $1
        RETURNING id
        "#,
    )
    .bind(id)
    .bind(&trimmed_name)
    .bind(&body.description)
    .bind(&body.kind)
    .fetch_optional(&state.db)
    .await
    .context("updating collection")?;

    if result.is_none() {
        return Err(ApiError::NotFound);
    }

    let detail = load_collection(&state.db, id).await?;
    Ok(Json(detail))
}

#[utoipa::path(
    delete,
    path = "/api/collections/{id}",
    params(("id" = Uuid, Path,)),
    responses(
        (status = 204, description = "deleted; cascades entries"),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn delete_collection(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    let affected = sqlx::query("DELETE FROM collections WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .context("deleting collection")?
        .rows_affected();

    if affected == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Handlers — entries
// ---------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/collections/{id}/entries",
    params(
        ("id" = Uuid, Path,),
        EntriesQuery,
    ),
    responses(
        (status = 200, body = EntriesPage),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn list_entries(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<EntriesQuery>,
) -> ApiResult<Json<EntriesPage>> {
    // 404 if the parent collection doesn't exist — keeps "GET /collections/{id}/entries"
    // and "GET /collections/{id}" semantically consistent.
    ensure_collection_exists(&state.db, id).await?;

    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * page_size;

    let rows = sqlx::query(
        r#"
        SELECT  e.id,
                e.collection_id,
                e.printing_id,
                p.set_code,
                p.collector_number,
                c.name AS printing_name,
                e.quantity,
                e.finish,
                e.language,
                e.condition,
                e.acquired_at,
                e.acquired_from,
                e.notes,
                e.created_at,
                e.updated_at
        FROM collection_entries e
        JOIN printings p ON p.id = e.printing_id
        JOIN cards     c ON c.oracle_id = p.oracle_id
        WHERE e.collection_id = $1
        ORDER BY e.created_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(id)
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .context("listing collection entries")?;

    let items = rows.into_iter().map(row_to_entry).collect();

    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_entries WHERE collection_id = $1")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .context("counting collection entries")?;

    Ok(Json(EntriesPage {
        items,
        page,
        page_size,
        total,
    }))
}

/// Add an entry to a collection.
///
/// **Collapsing behaviour:** if a row already exists with the same
/// `(collection_id, printing_id, finish, language, condition)` tuple, the
/// existing row's `quantity` is incremented by the requested quantity instead
/// of failing the unique constraint. Provenance fields (`acquired_at`,
/// `acquired_from`, `notes`) on a collapse are *only* overwritten when a
/// non-null value is supplied — otherwise the existing provenance is preserved.
#[utoipa::path(
    post,
    path = "/api/collections/{id}/entries",
    params(("id" = Uuid, Path,)),
    request_body = CreateEntryBody,
    responses(
        (status = 201, body = CollectionEntry),
        (status = 400, description = "validation error"),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn create_entry(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateEntryBody>,
) -> ApiResult<(StatusCode, Json<CollectionEntry>)> {
    validate_quantity_create(body.quantity)?;
    ensure_collection_exists(&state.db, id).await?;

    let finish = body.finish.unwrap_or_default();
    let condition = body.condition.unwrap_or_default();
    let language = body.language.clone().unwrap_or_else(|| "en".to_string());

    // INSERT ... ON CONFLICT collapses duplicates per the unique constraint.
    let inserted = sqlx::query(
        r#"
        INSERT INTO collection_entries
            (collection_id, printing_id, quantity, finish, language, condition,
             acquired_at, acquired_from, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (collection_id, printing_id, finish, language, condition)
        DO UPDATE SET
            quantity      = collection_entries.quantity + EXCLUDED.quantity,
            acquired_at   = COALESCE(EXCLUDED.acquired_at,   collection_entries.acquired_at),
            acquired_from = COALESCE(EXCLUDED.acquired_from, collection_entries.acquired_from),
            notes         = COALESCE(EXCLUDED.notes,         collection_entries.notes)
        RETURNING id
        "#,
    )
    .bind(id)
    .bind(body.printing_id)
    .bind(body.quantity)
    .bind(finish)
    .bind(&language)
    .bind(condition)
    .bind(body.acquired_at)
    .bind(&body.acquired_from)
    .bind(&body.notes)
    .fetch_one(&state.db)
    .await
    .map_err(map_printing_fk_error)?;

    let entry_id: Uuid = inserted.get("id");
    let entry = load_entry(&state.db, id, entry_id).await?;
    Ok((StatusCode::CREATED, Json(entry)))
}

/// Partial update for an entry.
///
/// **Delete-on-zero:** when `quantity = 0` is supplied, the row is deleted
/// and the endpoint returns `204 No Content`. The DB-level CHECK constraint
/// (`quantity > 0`) forbids writing a 0-row, so we honour that by removing
/// the entry — matches the "physical pile" mental model: 0 means "gone".
#[utoipa::path(
    patch,
    path = "/api/collections/{id}/entries/{entry_id}",
    params(
        ("id" = Uuid, Path,),
        ("entry_id" = Uuid, Path,),
    ),
    request_body = UpdateEntryBody,
    responses(
        (status = 200, body = CollectionEntry),
        (status = 204, description = "quantity was 0; entry deleted"),
        (status = 400, description = "validation error"),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn update_entry(
    State(state): State<AppState>,
    Path((collection_id, entry_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateEntryBody>,
) -> ApiResult<axum::response::Response> {
    use axum::response::IntoResponse;

    // Delete-on-zero short-circuit.
    if matches!(body.quantity, Some(q) if q <= 0) {
        if body.quantity == Some(0) {
            let affected =
                sqlx::query("DELETE FROM collection_entries WHERE collection_id = $1 AND id = $2")
                    .bind(collection_id)
                    .bind(entry_id)
                    .execute(&state.db)
                    .await
                    .context("deleting entry on quantity=0")?
                    .rows_affected();
            if affected == 0 {
                return Err(ApiError::NotFound);
            }
            return Ok(StatusCode::NO_CONTENT.into_response());
        }
        return Err(ApiError::validation(
            "`quantity` must be >= 0 (use 0 to delete the entry)",
        ));
    }

    let updated = sqlx::query(
        r#"
        UPDATE collection_entries
        SET quantity      = COALESCE($3, quantity),
            finish        = COALESCE($4, finish),
            language      = COALESCE($5, language),
            condition     = COALESCE($6, condition),
            acquired_at   = COALESCE($7, acquired_at),
            acquired_from = COALESCE($8, acquired_from),
            notes         = COALESCE($9, notes)
        WHERE collection_id = $1 AND id = $2
        RETURNING id
        "#,
    )
    .bind(collection_id)
    .bind(entry_id)
    .bind(body.quantity)
    .bind(body.finish)
    .bind(&body.language)
    .bind(body.condition)
    .bind(body.acquired_at)
    .bind(&body.acquired_from)
    .bind(&body.notes)
    .fetch_optional(&state.db)
    .await
    .context("updating collection entry")?;

    if updated.is_none() {
        return Err(ApiError::NotFound);
    }

    let entry = load_entry(&state.db, collection_id, entry_id).await?;
    Ok(Json(entry).into_response())
}

#[utoipa::path(
    delete,
    path = "/api/collections/{id}/entries/{entry_id}",
    params(
        ("id" = Uuid, Path,),
        ("entry_id" = Uuid, Path,),
    ),
    responses(
        (status = 204),
        (status = 404)
    ),
    tag = "collections"
)]
pub async fn delete_entry(
    State(state): State<AppState>,
    Path((collection_id, entry_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    let affected =
        sqlx::query("DELETE FROM collection_entries WHERE collection_id = $1 AND id = $2")
            .bind(collection_id)
            .bind(entry_id)
            .execute(&state.db)
            .await
            .context("deleting collection entry")?
            .rows_affected();
    if affected == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn ensure_collection_exists(pool: &PgPool, id: Uuid) -> ApiResult<()> {
    let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM collections WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .context("checking collection existence")?;
    if exists.is_none() {
        return Err(ApiError::NotFound);
    }
    Ok(())
}

async fn load_collection(pool: &PgPool, id: Uuid) -> ApiResult<CollectionDetail> {
    let row = sqlx::query(
        r#"
        SELECT c.id,
               c.name,
               c.description,
               c.kind,
               c.created_at,
               c.updated_at,
               COALESCE(COUNT(e.id), 0)::bigint     AS distinct_printings,
               COALESCE(SUM(e.quantity), 0)::bigint AS total_quantity
        FROM collections c
        LEFT JOIN collection_entries e ON e.collection_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .context("loading collection")?;

    let Some(row) = row else {
        return Err(ApiError::NotFound);
    };

    Ok(CollectionDetail {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        kind: row.get("kind"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        distinct_printings: row.get("distinct_printings"),
        total_quantity: row.get("total_quantity"),
    })
}

async fn load_entry(
    pool: &PgPool,
    collection_id: Uuid,
    entry_id: Uuid,
) -> ApiResult<CollectionEntry> {
    let row = sqlx::query(
        r#"
        SELECT  e.id,
                e.collection_id,
                e.printing_id,
                p.set_code,
                p.collector_number,
                c.name AS printing_name,
                e.quantity,
                e.finish,
                e.language,
                e.condition,
                e.acquired_at,
                e.acquired_from,
                e.notes,
                e.created_at,
                e.updated_at
        FROM collection_entries e
        JOIN printings p ON p.id = e.printing_id
        JOIN cards     c ON c.oracle_id = p.oracle_id
        WHERE e.collection_id = $1 AND e.id = $2
        "#,
    )
    .bind(collection_id)
    .bind(entry_id)
    .fetch_optional(pool)
    .await
    .context("loading collection entry")?;

    let Some(row) = row else {
        return Err(ApiError::NotFound);
    };
    Ok(row_to_entry(row))
}

fn row_to_entry(row: sqlx::postgres::PgRow) -> CollectionEntry {
    CollectionEntry {
        id: row.get("id"),
        collection_id: row.get("collection_id"),
        printing_id: row.get("printing_id"),
        printing_name: row.get("printing_name"),
        set_code: row.get("set_code"),
        collector_number: row.get("collector_number"),
        quantity: row.get("quantity"),
        finish: row.get("finish"),
        language: row.get("language"),
        condition: row.get("condition"),
        acquired_at: row.get("acquired_at"),
        acquired_from: row.get("acquired_from"),
        notes: row.get("notes"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

/// Turn a foreign-key violation on `printing_id` into a 400 instead of letting
/// it bubble out as a 500. Any other database error keeps its existing path.
fn map_printing_fk_error(err: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db_err) = &err {
        if db_err.code().as_deref() == Some("23503") {
            return ApiError::validation(format!(
                "`printing_id` does not reference an existing printing: {}",
                db_err.message()
            ));
        }
    }
    ApiError::Database(err)
}
