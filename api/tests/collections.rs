//! Integration tests for the collections + entries endpoints.
//!
//! Each test gets a fresh per-test database from `#[sqlx::test]` with the same
//! migrations the API binary applies. We seed a minimal Scryfall fixture so we
//! have a real `printings.id` to reference, then exercise handlers through an
//! in-process Axum router (no network).

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt; // for `oneshot`
use tutor_api::{build_router, scryfall::import, AppState};

/// Seed the catalog fixtures and return the first printing UUID we can use as
/// `printing_id` in collection entries.
async fn seed_catalog(pool: &PgPool) -> uuid::Uuid {
    let sets: tutor_api::scryfall::models::SetList =
        serde_json::from_str(include_str!("fixtures/sets.json")).expect("sets fixture parses");
    import::upsert_sets(pool, &sets.data).await.unwrap();

    let oracle: Vec<tutor_api::scryfall::models::ScryfallCard> =
        serde_json::from_str(include_str!("fixtures/oracle_cards.json"))
            .expect("oracle fixture parses");
    import::upsert_oracle_cards(pool, &oracle).await.unwrap();

    let printings: Vec<tutor_api::scryfall::models::ScryfallCard> =
        serde_json::from_str(include_str!("fixtures/printings.json"))
            .expect("printings fixture parses");
    import::upsert_printings(pool, &printings).await.unwrap();

    sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM printings ORDER BY created_at LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn send(
    app: axum::Router,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    let body = match body {
        Some(v) => Body::from(v.to_string()),
        None => Body::empty(),
    };
    let response = app.oneshot(req.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

fn app(pool: PgPool) -> axum::Router {
    build_router(AppState { db: pool })
}

#[sqlx::test(migrations = "./migrations")]
async fn duplicate_entry_collapses_quantity_and_delete_on_zero(pool: PgPool) {
    let printing_id = seed_catalog(&pool).await;

    // 1) Create a collection.
    let (status, body) = send(
        app(pool.clone()),
        Method::POST,
        "/api/collections",
        Some(json!({ "name": "Main Binder" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    let collection_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["name"], "Main Binder");
    assert_eq!(body["kind"], "general");
    assert_eq!(body["distinct_printings"], 0);
    assert_eq!(body["total_quantity"], 0);

    // 2) POST the same printing+finish+language+condition tuple twice.
    let entry_body = json!({
        "printing_id": printing_id,
        "quantity": 1,
        "finish": "nonfoil",
        "language": "en",
        "condition": "near_mint"
    });

    let (s1, b1) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/collections/{collection_id}/entries"),
        Some(entry_body.clone()),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED, "body: {b1}");
    let entry_id = b1["id"].as_str().unwrap().to_string();
    assert_eq!(b1["quantity"], 1);

    let (s2, b2) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/collections/{collection_id}/entries"),
        Some(entry_body.clone()),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED, "body: {b2}");
    // Same entry id — collapsed onto the existing row.
    assert_eq!(b2["id"].as_str().unwrap(), entry_id);
    assert_eq!(b2["quantity"], 2);

    // Verify there is exactly one row in the DB.
    let row_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM collection_entries WHERE collection_id = $1::uuid",
    )
    .bind(&collection_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row_count, 1);

    // Sanity-check the collection totals.
    let (s_get, b_get) = send(
        app(pool.clone()),
        Method::GET,
        &format!("/api/collections/{collection_id}"),
        None,
    )
    .await;
    assert_eq!(s_get, StatusCode::OK);
    assert_eq!(b_get["distinct_printings"], 1);
    assert_eq!(b_get["total_quantity"], 2);

    // 3) PATCH that entry to quantity = 0 → it must be deleted.
    let (s3, _b3) = send(
        app(pool.clone()),
        Method::PATCH,
        &format!("/api/collections/{collection_id}/entries/{entry_id}"),
        Some(json!({ "quantity": 0 })),
    )
    .await;
    assert_eq!(s3, StatusCode::NO_CONTENT);

    let post_delete: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM collection_entries WHERE collection_id = $1::uuid",
    )
    .bind(&collection_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(post_delete, 0);

    let (_, b_after) = send(
        app(pool.clone()),
        Method::GET,
        &format!("/api/collections/{collection_id}"),
        None,
    )
    .await;
    assert_eq!(b_after["distinct_printings"], 0);
    assert_eq!(b_after["total_quantity"], 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn list_collections_and_validation_errors(pool: PgPool) {
    // Empty name → 400.
    let (status, body) = send(
        app(pool.clone()),
        Method::POST,
        "/api/collections",
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("must not be empty"));

    // Create two, then list.
    let _ = send(
        app(pool.clone()),
        Method::POST,
        "/api/collections",
        Some(json!({ "name": "A", "kind": "trade_binder" })),
    )
    .await;
    let _ = send(
        app(pool.clone()),
        Method::POST,
        "/api/collections",
        Some(json!({ "name": "B" })),
    )
    .await;

    let (status, body) = send(app(pool.clone()), Method::GET, "/api/collections", None).await;
    assert_eq!(status, StatusCode::OK);
    let arr = body.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    // newest first
    assert_eq!(arr[0]["name"], "B");
    assert_eq!(arr[1]["name"], "A");
    assert_eq!(arr[1]["kind"], "trade_binder");
}
