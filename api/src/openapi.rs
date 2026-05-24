use utoipa::OpenApi;

use crate::routes::{cards, health, sets};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Tutor API",
        version = env!("CARGO_PKG_VERSION"),
        description = "API for Tutor, the MTG collection and deckbuilding companion.",
    ),
    paths(
        health::get_health,
        cards::search_cards,
        cards::get_card,
        sets::list_sets,
    ),
    components(schemas(
        health::HealthStatus,
        health::DbStatus,
        health::DataStatus,
        cards::CardSummary,
        cards::SearchResponse,
        cards::CardDetail,
        cards::CardFace,
        cards::PrintingSummary,
        sets::SetSummary,
    )),
    tags(
        (name = "health", description = "Liveness and dependency probes"),
        (name = "cards", description = "Oracle catalog browse + detail"),
        (name = "sets", description = "MTG sets reference"),
    ),
)]
pub struct ApiDoc;
