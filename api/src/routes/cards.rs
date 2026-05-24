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

/// How to group results when scoping by `collection_id`. Ignored otherwise.
///
///   * `oracle` (default): one row per oracle card; `owned_quantity` is the
///     sum across every printing/finish/condition the user owns.
///   * `printing`: one row per `collection_entries` row (printing × finish ×
///     language × condition tuple); each row carries the printing-level
///     identity in the optional fields on `CardSummary`.
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Grouping {
    #[default]
    Oracle,
    Printing,
}

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
    /// Scope results to cards owned in this collection. When set, each
    /// row carries `owned_quantity` (>=1); when unset, the unscoped catalog
    /// is searched and `owned_quantity` is omitted.
    #[serde(default)]
    pub collection_id: Option<Uuid>,
    /// Row grouping for collection-scoped browse. Only meaningful when
    /// `collection_id` is set. Defaults to `oracle`.
    #[serde(default)]
    pub grouping: Option<Grouping>,
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
    /// Total copies owned in the scoped collection.
    /// `None` when the search is not scoped to a collection.
    /// When `grouping = oracle`, this is the sum across every printing /
    /// finish / language / condition of the card the user holds.
    /// When `grouping = printing`, this is the quantity of the single
    /// `collection_entries` row this result represents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owned_quantity: Option<i64>,
    /// Printing identity, only populated when `grouping = printing`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub printing_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collector_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
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
///
/// Three flavours, controlled by `collection_id` + `grouping`:
///   * Unscoped (no `collection_id`): catalog-wide oracle browse. Existing
///     Phase 5 behaviour; `owned_quantity` and printing fields are omitted.
///   * `collection_id` + `grouping=oracle` (default): one row per oracle
///     card owned in that collection. `owned_quantity` is the sum across
///     every printing/finish/language/condition row the user holds.
///   * `collection_id` + `grouping=printing`: one row per `collection_entries`
///     row, with printing identity (set_code, collector_number, finish,
///     language, condition) populated on each result.
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

    let collection_id = q.collection_id;
    let grouping = q.grouping.unwrap_or_default();

    // Printing-grouped browse short-circuits to its own query path. The
    // remaining branches all read from `cards c` with identical projection.
    if let Some(cid) = collection_id {
        if grouping == Grouping::Printing {
            return search_collection_printings(&state.db, &q, cid, page, page_size, offset)
                .await
                .map(Json);
        }
    }

    let total = count_search(&state.db, &q).await?;

    let mut items_qb = QueryBuilder::<sqlx::Postgres>::new(
        "SELECT c.oracle_id, c.name, c.mana_cost, c.mana_value, c.type_line, \
         c.colors, c.color_identity, c.edhrec_rank",
    );
    if let Some(cid) = collection_id {
        // Sum every owned copy of every printing of this oracle in the scoped
        // collection. Subquery keeps the outer GROUP BY off.
        items_qb.push(
            ", (SELECT COALESCE(SUM(e.quantity), 0)::bigint \
                 FROM collection_entries e \
                 JOIN printings p2 ON p2.id = e.printing_id \
                 WHERE e.collection_id = ",
        );
        items_qb.push_bind(cid);
        items_qb.push(" AND p2.oracle_id = c.oracle_id) AS owned_quantity");
    }
    items_qb.push(" FROM cards c WHERE 1=1");
    push_filters(&mut items_qb, &q);
    if let Some(cid) = collection_id {
        // Restrict to oracles the user actually owns in the scoped collection.
        items_qb.push(
            " AND EXISTS (SELECT 1 FROM collection_entries e \
                 JOIN printings p ON p.id = e.printing_id \
                 WHERE e.collection_id = ",
        );
        items_qb.push_bind(cid);
        items_qb.push(" AND p.oracle_id = c.oracle_id)");
    }
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
            owned_quantity: collection_id.map(|_| r.get::<i64, _>("owned_quantity")),
            printing_id: None,
            set_code: None,
            collector_number: None,
            finish: None,
            language: None,
            condition: None,
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
    if let Some(cid) = q.collection_id {
        qb.push(
            " AND EXISTS (SELECT 1 FROM collection_entries e \
                 JOIN printings p ON p.id = e.printing_id \
                 WHERE e.collection_id = ",
        );
        qb.push_bind(cid);
        qb.push(" AND p.oracle_id = c.oracle_id)");
    }
    let row = qb.build().fetch_one(pool).await?;
    Ok(row.get::<i64, _>(0))
}

/// Printing-grouped browse: one row per `collection_entries` row, joined with
/// the printing + card so we can apply the same filter set.
async fn search_collection_printings(
    pool: &PgPool,
    q: &SearchQuery,
    collection_id: Uuid,
    page: i64,
    page_size: i64,
    offset: i64,
) -> ApiResult<SearchResponse> {
    // Build a shared FROM/WHERE that both the count + the items query reuse.
    fn push_from_where<'a>(
        qb: &mut QueryBuilder<'a, sqlx::Postgres>,
        q: &'a SearchQuery,
        collection_id: Uuid,
    ) {
        qb.push(
            " FROM collection_entries e \
              JOIN printings p ON p.id = e.printing_id \
              JOIN cards c ON c.oracle_id = p.oracle_id \
              WHERE e.collection_id = ",
        );
        qb.push_bind(collection_id);
        push_filters(qb, q);
    }

    let mut count_qb = QueryBuilder::<sqlx::Postgres>::new("SELECT count(*)::bigint");
    push_from_where(&mut count_qb, q, collection_id);
    let total: i64 = count_qb.build().fetch_one(pool).await?.get(0);

    let mut items_qb = QueryBuilder::<sqlx::Postgres>::new(
        "SELECT c.oracle_id, c.name, c.mana_cost, c.mana_value, c.type_line, \
         c.colors, c.color_identity, c.edhrec_rank, \
         e.quantity::bigint AS owned_quantity, \
         e.printing_id, p.set_code, p.collector_number, \
         e.finish::text AS finish, e.language, e.condition::text AS condition",
    );
    push_from_where(&mut items_qb, q, collection_id);
    items_qb.push(" ORDER BY c.name ASC, p.set_code ASC, p.collector_number ASC LIMIT ");
    items_qb.push_bind(page_size);
    items_qb.push(" OFFSET ");
    items_qb.push_bind(offset);

    let rows = items_qb.build().fetch_all(pool).await?;

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
            owned_quantity: Some(r.get::<i64, _>("owned_quantity")),
            printing_id: Some(r.get("printing_id")),
            set_code: Some(r.get("set_code")),
            collector_number: Some(r.get("collector_number")),
            finish: Some(r.get("finish")),
            language: Some(r.get("language")),
            condition: Some(r.get("condition")),
        })
        .collect();

    Ok(SearchResponse {
        total,
        page,
        page_size,
        items,
    })
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
