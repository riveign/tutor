use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{error::ApiResult, AppState};

#[derive(Serialize, ToSchema)]
pub struct HealthStatus {
    pub status: &'static str,
    pub db: DbStatus,
    pub data: DataStatus,
    pub version: &'static str,
}

#[derive(Serialize, ToSchema)]
pub struct DbStatus {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Row counts for the core Scryfall-sourced tables. Lets the UI render a
/// "is the catalog loaded?" signal and lets ops verify ingest worked.
#[derive(Serialize, ToSchema, Default)]
pub struct DataStatus {
    pub sets: i64,
    pub cards: i64,
    pub printings: i64,
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
    let (db, data) = match sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
    {
        Ok(_) => {
            let data = data_status(&state.db).await.unwrap_or_default();
            (
                DbStatus {
                    connected: true,
                    error: None,
                },
                data,
            )
        }
        Err(e) => (
            DbStatus {
                connected: false,
                error: Some(e.to_string()),
            },
            DataStatus::default(),
        ),
    };

    Ok(Json(HealthStatus {
        status: "ok",
        db,
        data,
        version: env!("CARGO_PKG_VERSION"),
    }))
}

async fn data_status(pool: &sqlx::PgPool) -> sqlx::Result<DataStatus> {
    let sets: i64 = sqlx::query_scalar("SELECT count(*) FROM sets")
        .fetch_one(pool)
        .await?;
    let cards: i64 = sqlx::query_scalar("SELECT count(*) FROM cards")
        .fetch_one(pool)
        .await?;
    let printings: i64 = sqlx::query_scalar("SELECT count(*) FROM printings")
        .fetch_one(pool)
        .await?;
    Ok(DataStatus {
        sets,
        cards,
        printings,
    })
}
