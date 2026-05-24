//! Sets reference endpoint — flat list of every MTG set in the catalog.
//!
//! Returned in release-date-descending order so newest sets surface first;
//! sets with no release date sink to the bottom and sort by code.

use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use sqlx::Row;
use utoipa::ToSchema;

use crate::{error::ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new().route("/sets", get(list_sets))
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
    responses((status = 200, body = [SetSummary])),
    tag = "sets"
)]
pub async fn list_sets(State(state): State<AppState>) -> ApiResult<Json<Vec<SetSummary>>> {
    let rows = sqlx::query(
        "SELECT code, name, set_type, released_at, card_count, icon_svg_uri \
         FROM sets ORDER BY released_at DESC NULLS LAST, code ASC",
    )
    .fetch_all(&state.db)
    .await?;

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
