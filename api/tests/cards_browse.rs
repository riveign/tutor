//! Integration tests for the catalog browse + detail endpoints.
//!
//! Each test starts from a fresh per-test database (via `#[sqlx::test]`)
//! seeded with the same JSON fixtures used by the ingest tests, then
//! invokes the route handlers directly with manually-constructed axum
//! extractors. We assert against the typed `Json<…>` responses without
//! spinning up a real HTTP server.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use sqlx::PgPool;
use uuid::Uuid;

use tutor_api::routes::cards::{get_card, search_cards, CardDetail, SearchQuery, SearchResponse};
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

async fn seed(pool: &PgPool) {
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

fn empty_query() -> SearchQuery {
    SearchQuery {
        q: None,
        colors: None,
        color_identity: None,
        type_line: None,
        set_code: None,
        format: None,
        page: None,
        page_size: None,
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn search_by_name_returns_match(pool: PgPool) {
    seed(&pool).await;

    let q = SearchQuery {
        q: Some("lightning".into()),
        ..empty_query()
    };
    let Json(SearchResponse { items, total, .. }) =
        search_cards(state(pool), Query(q)).await.unwrap();

    assert_eq!(total, 1);
    let names: Vec<_> = items.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["Lightning Bolt"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn search_filters_by_color_identity_subset(pool: PgPool) {
    seed(&pool).await;

    let q = SearchQuery {
        color_identity: Some("G".into()),
        ..empty_query()
    };
    let Json(SearchResponse { items, .. }) = search_cards(state(pool), Query(q)).await.unwrap();

    let names: Vec<_> = items.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["Boseiju, Who Endures"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn search_filters_by_set_via_printings(pool: PgPool) {
    seed(&pool).await;

    let q = SearchQuery {
        set_code: Some("neo".into()),
        ..empty_query()
    };
    let Json(SearchResponse { items, .. }) = search_cards(state(pool), Query(q)).await.unwrap();

    let mut names: Vec<_> = items.iter().map(|c| c.name.clone()).collect();
    names.sort();
    assert_eq!(names, vec!["Boseiju, Who Endures", "Lightning Bolt"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn search_paginates(pool: PgPool) {
    seed(&pool).await;

    let q1 = SearchQuery {
        page: Some(1),
        page_size: Some(2),
        ..empty_query()
    };
    let Json(SearchResponse {
        items: p1, total, ..
    }) = search_cards(state(pool.clone()), Query(q1)).await.unwrap();
    assert_eq!(total, 3);
    assert_eq!(p1.len(), 2);

    let q2 = SearchQuery {
        page: Some(2),
        page_size: Some(2),
        ..empty_query()
    };
    let Json(SearchResponse { items: p2, .. }) =
        search_cards(state(pool), Query(q2)).await.unwrap();
    assert_eq!(p2.len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn detail_returns_faces_and_printings(pool: PgPool) {
    seed(&pool).await;

    let wrenn: Uuid = "cccccccc-cccc-cccc-cccc-cccccccccccc".parse().unwrap();
    let Json(CardDetail { faces, name, .. }) = get_card(state(pool), Path(wrenn)).await.unwrap();

    assert_eq!(name, "Wrenn and Realmbreaker");
    assert_eq!(faces.len(), 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn detail_missing_returns_not_found(pool: PgPool) {
    seed(&pool).await;

    let err = get_card(state(pool), Path(Uuid::nil()))
        .await
        .expect_err("missing oracle_id must error");
    assert_eq!(err.to_string(), "not found");
}
