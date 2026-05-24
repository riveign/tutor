use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{error::ApiResult, AppState};

#[derive(Serialize, ToSchema)]
pub struct HealthStatus {
    pub status: &'static str,
    pub db: DbStatus,
    pub version: &'static str,
}

#[derive(Serialize, ToSchema)]
pub struct DbStatus {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(get_health))
}

/// Liveness + database connectivity probe.
#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, body = HealthStatus)
    ),
    tag = "health"
)]
pub async fn get_health(State(state): State<AppState>) -> ApiResult<Json<HealthStatus>> {
    let db = match sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.db).await {
        Ok(_) => DbStatus { connected: true, error: None },
        Err(e) => DbStatus { connected: false, error: Some(e.to_string()) },
    };

    Ok(Json(HealthStatus {
        status: "ok",
        db,
        version: env!("CARGO_PKG_VERSION"),
    }))
}
