//! Integration tests for the collection-scoped browse path on `/cards/search`
//! (Phase 8b — "browse just like we browse cards but for each collection").
//!
//! Verifies:
//!   * `grouping=oracle` (default) collapses every printing/finish/condition
//!     row into one per oracle card, with `owned_quantity` summed.
//!   * `grouping=printing` returns one row per `collection_entries` row, with
//!     printing identity populated on each result.
//!   * The standard `/cards/search` filters (e.g. `colors`) compose with the
//!     collection scope.

use axum::{
    extract::{Query, State},
    Json,
};
use sqlx::PgPool;
use uuid::Uuid;

use tutor_api::routes::cards::{search_cards, Grouping, SearchQuery, SearchResponse};
use tutor_api::scryfall::{
    import,
    models::{ScryfallCard, SetList},
};
use tutor_api::AppState;

fn load_sets() -> SetList {
    serde_json::from_str(include_str!("fixtures/sets.json")).expect("sets fixture parses")
}

fn load_oracle() -> Vec<ScryfallCard> {
    serde_json::from_str(include_str!("fixtures/oracle_cards.json"))
        .expect("oracle_cards fixture parses")
}

fn load_printings() -> Vec<ScryfallCard> {
    serde_json::from_str(include_str!("fixtures/printings.json")).expect("printings fixture parses")
}

async fn seed_catalog(pool: &PgPool) {
    import::upsert_sets(pool, &load_sets().data).await.unwrap();
    import::upsert_oracle_cards(pool, &load_oracle())
        .await
        .unwrap();
    import::upsert_printings(pool, &load_printings())
        .await
        .unwrap();
}

fn state(pool: PgPool) -> State<AppState> {
    State(AppState { db: pool })
}

fn query_scoped(collection_id: Uuid, grouping: Option<Grouping>) -> SearchQuery {
    SearchQuery {
        q: None,
        colors: None,
        color_identity: None,
        type_line: None,
        set_code: None,
        collector_number: None,
        format: None,
        collection_id: Some(collection_id),
        grouping,
        page: None,
        page_size: None,
    }
}

const LB_LEA: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const LB_NEO: Uuid = Uuid::from_u128(0x44444444_4444_4444_4444_444444444444);
const BOSEIJU_NEO: Uuid = Uuid::from_u128(0x22222222_2222_2222_2222_222222222222);
const LIGHTNING_BOLT_ORACLE: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa);
const BOSEIJU_ORACLE: Uuid = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbbb);

/// Insert a collection with 4 entries: LB lea ×2, LB neo nonfoil ×1, LB neo
/// foil ×1, Boseiju neo nonfoil ×1. That gives us:
///   oracle grouping  → 2 rows (LB qty=4, Boseiju qty=1)
///   printing grouping → 4 rows
async fn seed_collection_with_entries(pool: &PgPool) -> Uuid {
    let collection_id: Uuid =
        sqlx::query_scalar("INSERT INTO collections (name) VALUES ('Test Pile') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap();

    // LB lea nonfoil ×2
    sqlx::query(
        "INSERT INTO collection_entries (collection_id, printing_id, quantity, finish) \
         VALUES ($1, $2, 2, 'nonfoil')",
    )
    .bind(collection_id)
    .bind(LB_LEA)
    .execute(pool)
    .await
    .unwrap();

    // LB neo nonfoil ×1
    sqlx::query(
        "INSERT INTO collection_entries (collection_id, printing_id, quantity, finish) \
         VALUES ($1, $2, 1, 'nonfoil')",
    )
    .bind(collection_id)
    .bind(LB_NEO)
    .execute(pool)
    .await
    .unwrap();

    // LB neo foil ×1 (same printing, different finish → distinct row)
    sqlx::query(
        "INSERT INTO collection_entries (collection_id, printing_id, quantity, finish) \
         VALUES ($1, $2, 1, 'foil')",
    )
    .bind(collection_id)
    .bind(LB_NEO)
    .execute(pool)
    .await
    .unwrap();

    // Boseiju neo nonfoil ×1
    sqlx::query(
        "INSERT INTO collection_entries (collection_id, printing_id, quantity, finish) \
         VALUES ($1, $2, 1, 'nonfoil')",
    )
    .bind(collection_id)
    .bind(BOSEIJU_NEO)
    .execute(pool)
    .await
    .unwrap();

    collection_id
}

#[sqlx::test(migrations = "./migrations")]
async fn oracle_grouping_collapses_printings_and_sums_quantity(pool: PgPool) {
    seed_catalog(&pool).await;
    let cid = seed_collection_with_entries(&pool).await;

    let Json(SearchResponse { items, total, .. }) = search_cards(
        state(pool),
        Query(query_scoped(cid, Some(Grouping::Oracle))),
    )
    .await
    .unwrap();

    assert_eq!(total, 2, "two distinct oracle cards owned");
    assert_eq!(items.len(), 2);

    let lb = items
        .iter()
        .find(|c| c.oracle_id == LIGHTNING_BOLT_ORACLE)
        .expect("Lightning Bolt in results");
    let boseiju = items
        .iter()
        .find(|c| c.oracle_id == BOSEIJU_ORACLE)
        .expect("Boseiju in results");

    // 2 (lea nonfoil) + 1 (neo nonfoil) + 1 (neo foil) = 4
    assert_eq!(lb.owned_quantity, Some(4));
    assert_eq!(boseiju.owned_quantity, Some(1));

    // Oracle grouping must NOT populate printing-level fields.
    assert_eq!(lb.printing_id, None);
    assert_eq!(lb.set_code, None);
    assert_eq!(lb.finish, None);
}

#[sqlx::test(migrations = "./migrations")]
async fn printing_grouping_returns_one_row_per_entry(pool: PgPool) {
    seed_catalog(&pool).await;
    let cid = seed_collection_with_entries(&pool).await;

    let Json(SearchResponse { items, total, .. }) = search_cards(
        state(pool),
        Query(query_scoped(cid, Some(Grouping::Printing))),
    )
    .await
    .unwrap();

    assert_eq!(total, 4, "four collection_entries rows");
    assert_eq!(items.len(), 4);

    // Every row must carry printing identity in the printing grouping.
    for row in &items {
        assert!(row.printing_id.is_some(), "printing_id populated");
        assert!(row.set_code.is_some(), "set_code populated");
        assert!(row.collector_number.is_some(), "collector_number populated");
        assert!(row.finish.is_some(), "finish populated");
        assert!(row.language.is_some(), "language populated");
        assert!(row.condition.is_some(), "condition populated");
        assert!(row.owned_quantity.is_some(), "owned_quantity populated");
    }

    // Sum of quantities matches the total physical count.
    let total_qty: i64 = items.iter().map(|c| c.owned_quantity.unwrap_or(0)).sum();
    assert_eq!(total_qty, 5);

    // The neo Lightning Bolt should appear twice (nonfoil + foil), with
    // distinct finishes.
    let neo_lb: Vec<_> = items
        .iter()
        .filter(|c| c.printing_id == Some(LB_NEO))
        .collect();
    assert_eq!(neo_lb.len(), 2);
    let mut finishes: Vec<_> = neo_lb
        .iter()
        .map(|c| c.finish.clone().unwrap_or_default())
        .collect();
    finishes.sort();
    assert_eq!(finishes, vec!["foil", "nonfoil"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn standard_filters_compose_with_collection_scope(pool: PgPool) {
    seed_catalog(&pool).await;
    let cid = seed_collection_with_entries(&pool).await;

    // `colors=R` should restrict to red cards only — i.e. Lightning Bolt,
    // collapsing the printings under oracle grouping.
    let mut q = query_scoped(cid, Some(Grouping::Oracle));
    q.colors = Some("R".into());

    let Json(SearchResponse { items, total, .. }) =
        search_cards(state(pool.clone()), Query(q)).await.unwrap();
    assert_eq!(total, 1);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].oracle_id, LIGHTNING_BOLT_ORACLE);
    assert_eq!(items[0].owned_quantity, Some(4));

    // Same filter under printing grouping: 3 LB entries (lea + neo nonfoil +
    // neo foil), Boseiju filtered out.
    let mut q = query_scoped(cid, Some(Grouping::Printing));
    q.colors = Some("R".into());

    let Json(SearchResponse { items, total, .. }) =
        search_cards(state(pool), Query(q)).await.unwrap();
    assert_eq!(total, 3);
    assert_eq!(items.len(), 3);
    for row in &items {
        assert_eq!(row.oracle_id, LIGHTNING_BOLT_ORACLE);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn unscoped_search_keeps_legacy_shape(pool: PgPool) {
    // Phase 5 contract: when no collection_id is set, owned_quantity and the
    // printing-identity fields must be omitted from each row.
    seed_catalog(&pool).await;

    let q = SearchQuery {
        q: None,
        colors: None,
        color_identity: None,
        type_line: None,
        set_code: None,
        collector_number: None,
        format: None,
        collection_id: None,
        grouping: None,
        page: None,
        page_size: None,
    };

    let Json(SearchResponse { items, .. }) = search_cards(state(pool), Query(q)).await.unwrap();

    assert!(!items.is_empty(), "fixture should return at least one card");
    for row in &items {
        assert_eq!(row.owned_quantity, None, "unscoped omits owned_quantity");
        assert_eq!(row.printing_id, None);
        assert_eq!(row.set_code, None);
        assert_eq!(row.finish, None);
    }
}
