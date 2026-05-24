use std::net::SocketAddr;

use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use tutor_api::{db, serve, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tutor_api=debug,sqlx=warn")),
        )
        .with(fmt::layer())
        .init();

    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;

    let pool = db::connect(&database_url).await?;
    db::migrate(&pool).await?;

    let addr: SocketAddr = std::env::var("API_BIND")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()?;

    serve(AppState { db: pool }, addr).await
}
