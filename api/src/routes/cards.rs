//! Card browse + detail endpoints.
//!
//! Every endpoint here projects from the oracle catalog (`cards` table)
//! joined opportunistically with `card_faces` and `printings`. We never
//! return a full Scryfall blob — the API surfaces only the fields the UI
//! needs, keeping the wire format stable independently of Scryfall.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder, Row};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{error::ApiError, error::ApiResult, AppState};

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 200;
const DETAIL_PRINTINGS_LIMIT: i64 = 25;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cards/search", get(search_cards))
        .route("/cards/:oracle_id", get(get_card))
}

// =============================================================================
// Search
// =============================================================================

/// Query string for `/cards/search`. All filters are AND-ed.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchQuery {
    /// Free-text name match (case-insensitive substring).
    #[serde(default)]
    pub q: Option<String>,
    /// Colors the card uses, comma-separated WUBRG single letters
    /// (e.g. "U,R"). Matches if any of the card's `colors` are in the set.
    #[serde(default)]
    pub colors: Option<String>,
    /// Color identity, comma-separated WUBRG. Matches if the card's
    /// `color_identity` is a subset of the given set — i.e. the card is
    /// playable in a commander deck of that identity.
    #[serde(default)]
    pub color_identity: Option<String>,
    /// Case-insensitive substring match on `type_line` (e.g. "Creature",
    /// "Instant", "Legendary Artifact").
    #[serde(default)]
    pub type_line: Option<String>,
    /// Restrict to cards that have at least one printing in this set.
    #[serde(default)]
    pub set_code: Option<String>,
    /// Restrict to cards legal in this format (commander, modern, …).
    #[serde(default)]
    pub format: Option<String>,
    /// 1-indexed page number.
    #[serde(default)]
    pub page: Option<i64>,
    /// Page size; clamped to MAX_PAGE_SIZE.
    #[serde(default)]
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CardSummary {
    pub oracle_id: Uuid,
    pub name: String,
    pub mana_cost: Option<String>,
    pub mana_value: f32,
    pub type_line: String,
    pub colors: Vec<String>,
    pub color_identity: Vec<String>,
    pub edhrec_rank: Option<i32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchResponse {
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub items: Vec<CardSummary>,
}

fn parse_color_csv(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_uppercase())
        .filter(|s| matches!(s.as_str(), "W" | "U" | "B" | "R" | "G"))
        .collect()
}

/// Apply every active filter from the query string to the given builder,
/// using a leading `WHERE 1=1` so each filter can prepend ` AND ...` safely.
fn push_filters<'a>(qb: &mut QueryBuilder<'a, sqlx::Postgres>, q: &'a SearchQuery) {
    if let Some(name) = q.q.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND c.name ILIKE ").push_bind(format!("%{name}%"));
    }
    if let Some(raw) = q.colors.as_deref().filter(|s| !s.is_empty()) {
        let cols = parse_color_csv(raw);
        if !cols.is_empty() {
            qb.push(" AND c.colors && ").push_bind(cols);
        }
    }
    if let Some(raw) = q.color_identity.as_deref().filter(|s| !s.is_empty()) {
        let cols = parse_color_csv(raw);
        // Subset: every color in c.color_identity must be in the requested set.
        qb.push(" AND c.color_identity <@ ").push_bind(cols);
    }
    if let Some(t) = q.type_line.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND c.type_line ILIKE ")
            .push_bind(format!("%{t}%"));
    }
    if let Some(set) = q.set_code.as_deref().filter(|s| !s.is_empty()) {
        qb.push(
            " AND EXISTS (SELECT 1 FROM printings p WHERE p.oracle_id = c.oracle_id AND p.set_code = ",
        )
        .push_bind(set.to_lowercase())
        .push(")");
    }
    if let Some(fmt) = q.format.as_deref().filter(|s| !s.is_empty()) {
        qb.push(" AND c.legalities ->> ")
            .push_bind(fmt.to_lowercase())
            .push(" = 'legal'");
    }
}

/// Paginated catalog search.
#[utoipa::path(
    get,
    path = "/api/cards/search",
    params(SearchQuery),
    responses((status = 200, body = SearchResponse)),
    tag = "cards"
)]
pub async fn search_cards(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> ApiResult<Json<SearchResponse>> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q
        .page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = (page - 1) * page_size;

    let total = count_search(&state.db, &q).await?;

    let mut items_qb = QueryBuilder::<sqlx::Postgres>::new(
        "SELECT c.oracle_id, c.name, c.mana_cost, c.mana_value, c.type_line, \
         c.colors, c.color_identity, c.edhrec_rank \
         FROM cards c WHERE 1=1",
    );
    push_filters(&mut items_qb, &q);
    items_qb.push(" ORDER BY c.edhrec_rank ASC NULLS LAST, c.name ASC LIMIT ");
    items_qb.push_bind(page_size);
    items_qb.push(" OFFSET ");
    items_qb.push_bind(offset);

    let rows = items_qb
        .build()
        .fetch_all(&state.db)
        .await
        .map_err(ApiError::Database)?;

    let items = rows
        .into_iter()
        .map(|r| CardSummary {
            oracle_id: r.get("oracle_id"),
            name: r.get("name"),
            mana_cost: r.get("mana_cost"),
            mana_value: r.get("mana_value"),
            type_line: r.get("type_line"),
            colors: r.get("colors"),
            color_identity: r.get("color_identity"),
            edhrec_rank: r.get("edhrec_rank"),
        })
        .collect();

    Ok(Json(SearchResponse {
        total,
        page,
        page_size,
        items,
    }))
}

async fn count_search(pool: &PgPool, q: &SearchQuery) -> Result<i64, ApiError> {
    let mut qb = QueryBuilder::<sqlx::Postgres>::new("SELECT count(*) FROM cards c WHERE 1=1");
    push_filters(&mut qb, q);
    let row = qb.build().fetch_one(pool).await?;
    Ok(row.get::<i64, _>(0))
}

// =============================================================================
// Detail
// =============================================================================

#[derive(Debug, Serialize, ToSchema)]
pub struct CardFace {
    pub face_index: i32,
    pub name: String,
    pub mana_cost: Option<String>,
    pub type_line: Option<String>,
    pub oracle_text: Option<String>,
    pub power: Option<String>,
    pub toughness: Option<String>,
    pub loyalty: Option<String>,
    pub colors: Vec<String>,
    pub artist: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PrintingSummary {
    pub id: Uuid,
    pub set_code: String,
    pub set_name: String,
    pub collector_number: String,
    pub rarity: String,
    pub released_at: Option<chrono::NaiveDate>,
    pub finishes: Vec<String>,
    pub image_uris: serde_json::Value,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CardDetail {
    pub oracle_id: Uuid,
    pub name: String,
    pub layout: String,
    pub mana_cost: Option<String>,
    pub mana_value: f32,
    pub type_line: String,
    pub oracle_text: Option<String>,
    pub colors: Vec<String>,
    pub color_identity: Vec<String>,
    pub keywords: Vec<String>,
    pub power: Option<String>,
    pub toughness: Option<String>,
    pub loyalty: Option<String>,
    pub legalities: serde_json::Value,
    pub edhrec_rank: Option<i32>,
    pub faces: Vec<CardFace>,
    pub printings: Vec<PrintingSummary>,
}

/// Full oracle card with all faces and the most recent printings.
#[utoipa::path(
    get,
    path = "/api/cards/{oracle_id}",
    params(("oracle_id" = Uuid, Path, description = "Scryfall oracle_id")),
    responses(
        (status = 200, body = CardDetail),
        (status = 404, description = "no card with that oracle_id"),
    ),
    tag = "cards"
)]
pub async fn get_card(
    State(state): State<AppState>,
    Path(oracle_id): Path<Uuid>,
) -> ApiResult<Json<CardDetail>> {
    let card = sqlx::query(
        "SELECT oracle_id, name, layout, mana_cost, mana_value, type_line, oracle_text, \
         colors, color_identity, keywords, power, toughness, loyalty, legalities, edhrec_rank \
         FROM cards WHERE oracle_id = $1",
    )
    .bind(oracle_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::NotFound)?;

    let face_rows = sqlx::query(
        "SELECT face_index, name, mana_cost, type_line, oracle_text, power, toughness, \
         loyalty, colors, artist \
         FROM card_faces WHERE oracle_id = $1 ORDER BY face_index ASC",
    )
    .bind(oracle_id)
    .fetch_all(&state.db)
    .await?;

    let printing_rows = sqlx::query(
        "SELECT p.id, p.set_code, s.name AS set_name, p.collector_number, p.rarity, \
         p.released_at, p.finishes, p.image_uris \
         FROM printings p \
         JOIN sets s ON s.code = p.set_code \
         WHERE p.oracle_id = $1 \
         ORDER BY p.released_at DESC NULLS LAST \
         LIMIT $2",
    )
    .bind(oracle_id)
    .bind(DETAIL_PRINTINGS_LIMIT)
    .fetch_all(&state.db)
    .await?;

    let faces = face_rows
        .into_iter()
        .map(|r| CardFace {
            face_index: r.get("face_index"),
            name: r.get("name"),
            mana_cost: r.get("mana_cost"),
            type_line: r.get("type_line"),
            oracle_text: r.get("oracle_text"),
            power: r.get("power"),
            toughness: r.get("toughness"),
            loyalty: r.get("loyalty"),
            colors: r.get("colors"),
            artist: r.get("artist"),
        })
        .collect();

    let printings = printing_rows
        .into_iter()
        .map(|r| PrintingSummary {
            id: r.get("id"),
            set_code: r.get("set_code"),
            set_name: r.get("set_name"),
            collector_number: r.get("collector_number"),
            rarity: r.get("rarity"),
            released_at: r.get("released_at"),
            finishes: r.get("finishes"),
            image_uris: r.get("image_uris"),
        })
        .collect();

    Ok(Json(CardDetail {
        oracle_id: card.get("oracle_id"),
        name: card.get("name"),
        layout: card.get("layout"),
        mana_cost: card.get("mana_cost"),
        mana_value: card.get("mana_value"),
        type_line: card.get("type_line"),
        oracle_text: card.get("oracle_text"),
        colors: card.get("colors"),
        color_identity: card.get("color_identity"),
        keywords: card.get("keywords"),
        power: card.get("power"),
        toughness: card.get("toughness"),
        loyalty: card.get("loyalty"),
        legalities: card.get("legalities"),
        edhrec_rank: card.get("edhrec_rank"),
        faces,
        printings,
    }))
}
