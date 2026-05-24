//! Sets reference endpoint — flat list of every MTG set in the catalog.
//!
//! Returned in release-date-descending order so newest sets surface first;
//! sets with no release date sink to the bottom and sort by code.
//!
//! Phase 8d added an optional `q` filter (case-insensitive substring match
//! against `code` OR `name`) so the collector-# add flow can autocomplete
//! sets without paginating the whole catalog client-side, and a `limit`
//! clamp so the unfiltered list stays bounded.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row};
use utoipa::{IntoParams, ToSchema};

use crate::{error::ApiResult, AppState};

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 500;

pub fn router() -> Router<AppState> {
    Router::new().route("/sets", get(list_sets))
}

/// Optional filters for `/sets`.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListSetsQuery {
    /// Case-insensitive substring match against `code` OR `name`.
    #[serde(default)]
    pub q: Option<String>,
    /// Max rows to return; clamped to MAX_LIMIT. Defaults to 50.
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SetSummary {
    pub code: String,
    pub name: String,
    pub set_type: Option<String>,
    pub released_at: Option<chrono::NaiveDate>,
    pub card_count: Option<i32>,
    pub icon_svg_uri: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/sets",
    params(ListSetsQuery),
    responses((status = 200, body = [SetSummary])),
    tag = "sets"
)]
pub async fn list_sets(
    State(state): State<AppState>,
    Query(q): Query<ListSetsQuery>,
) -> ApiResult<Json<Vec<SetSummary>>> {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let mut qb = QueryBuilder::<sqlx::Postgres>::new(
        "SELECT code, name, set_type, released_at, card_count, icon_svg_uri \
         FROM sets WHERE 1=1",
    );
    if let Some(needle) = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let pat = format!("%{needle}%");
        qb.push(" AND (code ILIKE ")
            .push_bind(pat.clone())
            .push(" OR name ILIKE ")
            .push_bind(pat)
            .push(")");
    }
    qb.push(" ORDER BY released_at DESC NULLS LAST, code ASC LIMIT ");
    qb.push_bind(limit);

    let rows = qb.build().fetch_all(&state.db).await?;

    let items = rows
        .into_iter()
        .map(|r| SetSummary {
            code: r.get("code"),
            name: r.get("name"),
            set_type: r.get("set_type"),
            released_at: r.get("released_at"),
            card_count: r.get("card_count"),
            icon_svg_uri: r.get("icon_svg_uri"),
        })
        .collect();

    Ok(Json(items))
}
