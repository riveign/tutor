//! Integration tests for `GET /sets`.
//!
//! Covers the Phase 8d additions: optional `q` filter (substring match against
//! `code` OR `name`) and ordering by `released_at DESC NULLS LAST`.

use axum::{
    extract::{Query, State},
    Json,
};
use sqlx::PgPool;

use tutor_api::routes::sets::{list_sets, ListSetsQuery, SetSummary};
use tutor_api::scryfall::{import, models::SetList};
use tutor_api::AppState;

fn load_sets() -> SetList {
    serde_json::from_str(include_str!("fixtures/sets.json")).expect("sets fixture parses")
}

async fn seed(pool: &PgPool) {
    import::upsert_sets(pool, &load_sets().data).await.unwrap();
}

fn state(pool: PgPool) -> State<AppState> {
    State(AppState { db: pool })
}

#[sqlx::test(migrations = "./migrations")]
async fn list_sets_returns_newest_first(pool: PgPool) {
    seed(&pool).await;

    let q = ListSetsQuery { q: None, limit: None };
    let Json(items): Json<Vec<SetSummary>> = list_sets(state(pool), Query(q)).await.unwrap();

    // Fixture has lea (1993) and neo (2022). Newest must come first.
    let codes: Vec<_> = items.iter().map(|s| s.code.as_str()).collect();
    assert_eq!(codes, vec!["neo", "lea"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn list_sets_filters_by_q_against_name(pool: PgPool) {
    seed(&pool).await;

    let q = ListSetsQuery {
        q: Some("kamigawa".into()),
        limit: None,
    };
    let Json(items): Json<Vec<SetSummary>> = list_sets(state(pool), Query(q)).await.unwrap();

    let names: Vec<_> = items.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["Kamigawa: Neon Dynasty"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn list_sets_filters_by_q_against_code(pool: PgPool) {
    seed(&pool).await;

    let q = ListSetsQuery {
        q: Some("ne".into()),
        limit: None,
    };
    let Json(items): Json<Vec<SetSummary>> = list_sets(state(pool), Query(q)).await.unwrap();

    // "ne" matches neo's code and also "Edition" inside lea's name? — No, lea
    // is "Limited Edition Alpha", which contains the substring "ne" via the
    // n in "Edition"... actually that's "Editi" → no "ne" run. Confirm only neo.
    let codes: Vec<_> = items.iter().map(|s| s.code.as_str()).collect();
    assert_eq!(codes, vec!["neo"]);
}
