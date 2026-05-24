use utoipa::OpenApi;

use crate::routes::health;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Tutor API",
        version = env!("CARGO_PKG_VERSION"),
        description = "API for Tutor, the MTG collection and deckbuilding companion.",
    ),
    paths(health::get_health),
    components(schemas(health::HealthStatus, health::DbStatus)),
    tags(
        (name = "health", description = "Liveness and dependency probes"),
    ),
)]
pub struct ApiDoc;
