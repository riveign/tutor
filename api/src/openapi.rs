use utoipa::OpenApi;

use crate::routes::{cards, collections, health, sets};

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
        collections::list_collections,
        collections::create_collection,
        collections::get_collection,
        collections::update_collection,
        collections::delete_collection,
        collections::list_entries,
        collections::create_entry,
        collections::update_entry,
        collections::delete_entry,
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
        collections::CardFinish,
        collections::CardCondition,
        collections::CollectionSummary,
        collections::CollectionDetail,
        collections::CollectionEntry,
        collections::CreateCollectionBody,
        collections::UpdateCollectionBody,
        collections::CreateEntryBody,
        collections::UpdateEntryBody,
        collections::EntriesPage,
    )),
    tags(
        (name = "health", description = "Liveness and dependency probes"),
        (name = "cards", description = "Oracle catalog browse + detail"),
        (name = "sets", description = "MTG sets reference"),
        (name = "collections", description = "User-owned physical collections and their entries"),
    ),
)]
pub struct ApiDoc;
