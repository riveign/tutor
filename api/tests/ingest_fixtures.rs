//! Offline integration tests for the Scryfall upsert pipeline.
//!
//! Each test gets a fresh per-test database from `#[sqlx::test]` with the
//! same migrations the API binary applies, so we exercise the real schema —
//! triggers, constraints, JSONB columns and all — without ever hitting the
//! network. Fixtures live in `tests/fixtures/` and mimic Scryfall payloads.

use sqlx::PgPool;
use tutor_api::scryfall::{
    import,
    models::{ScryfallCard, SetList},
};

fn load_sets() -> SetList {
    let raw = include_str!("fixtures/sets.json");
    serde_json::from_str(raw).expect("sets fixture parses")
}

fn load_oracle() -> Vec<ScryfallCard> {
    let raw = include_str!("fixtures/oracle_cards.json");
    serde_json::from_str(raw).expect("oracle_cards fixture parses")
}

fn load_printings() -> Vec<ScryfallCard> {
    let raw = include_str!("fixtures/printings.json");
    serde_json::from_str(raw).expect("printings fixture parses")
}

async fn count(pool: &PgPool, table: &str) -> i64 {
    let q = format!("SELECT count(*) FROM {table}");
    sqlx::query_scalar(&q).fetch_one(pool).await.unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn upsert_sets_is_idempotent(pool: PgPool) {
    let sets = load_sets();
    let n1 = import::upsert_sets(&pool, &sets.data).await.unwrap();
    let n2 = import::upsert_sets(&pool, &sets.data).await.unwrap();
    assert_eq!(n1, 2);
    assert_eq!(n2, 2);
    assert_eq!(count(&pool, "sets").await, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn upsert_oracle_cards_creates_faces(pool: PgPool) {
    import::upsert_sets(&pool, &load_sets().data).await.unwrap();
    let cards = load_oracle();
    let n = import::upsert_oracle_cards(&pool, &cards).await.unwrap();
    assert_eq!(n, 3);
    assert_eq!(count(&pool, "cards").await, 3);
    // 2 single-face cards → 1 row each; 1 transform card → 2 rows. Total 4.
    assert_eq!(count(&pool, "card_faces").await, 4);

    // Re-running upserts the same rows — no duplicates, no orphan faces.
    let n2 = import::upsert_oracle_cards(&pool, &cards).await.unwrap();
    assert_eq!(n2, 3);
    assert_eq!(count(&pool, "cards").await, 3);
    assert_eq!(count(&pool, "card_faces").await, 4);
}

#[sqlx::test(migrations = "./migrations")]
async fn upsert_printings_links_to_oracle(pool: PgPool) {
    import::upsert_sets(&pool, &load_sets().data).await.unwrap();
    import::upsert_oracle_cards(&pool, &load_oracle())
        .await
        .unwrap();

    let printings = load_printings();
    let n = import::upsert_printings(&pool, &printings).await.unwrap();
    assert_eq!(n, 3);
    assert_eq!(count(&pool, "printings").await, 3);

    // Two printings for the same oracle_id (Lightning Bolt) — verify the FK
    // collapse worked.
    let bolt_printings: i64 =
        sqlx::query_scalar("SELECT count(*) FROM printings WHERE oracle_id = $1")
            .bind(uuid::Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bolt_printings, 2);

    // Idempotent.
    let n2 = import::upsert_printings(&pool, &printings).await.unwrap();
    assert_eq!(n2, 3);
    assert_eq!(count(&pool, "printings").await, 3);
}
