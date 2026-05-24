pub mod db;
pub mod error;
pub mod openapi;
pub mod routes;

use std::net::SocketAddr;

use axum::Router;
use sqlx::PgPool;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
}

pub fn build_router(state: AppState) -> Router {
    let api_doc = openapi::ApiDoc::openapi();

    Router::new()
        .merge(SwaggerUi::new("/docs").url("/openapi.json", api_doc))
        .nest("/api", routes::router())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub async fn serve(state: AppState, addr: SocketAddr) -> anyhow::Result<()> {
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "tutor-api listening");
    axum::serve(listener, app).await?;
    Ok(())
}
