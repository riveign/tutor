//! Integration tests for the decks + deck-entries endpoints.
//!
//! Each test gets a fresh per-test database from `#[sqlx::test]`. We seed a
//! minimal `sets` / `cards` / `printings` fixture inline so we have:
//!   * one Legendary Creature oracle (valid commander)
//!   * one Instant oracle (invalid commander)
//!   * one printing pinned to the legendary creature
//!
//! We exercise the handlers through an in-process Axum router.

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use tutor_api::{build_router, AppState};

/// Oracle UUIDs we use across the suite.
const LEGEND_ORACLE: &str = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INSTANT_ORACLE: &str = "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SECOND_LEGEND_ORACLE: &str = "33333333-cccc-cccc-cccc-cccccccccccc";

/// Set + printing UUIDs for the legendary creature pin.
const LEGEND_PRINTING: &str = "99999999-9999-9999-9999-999999999999";

async fn seed_minimal_catalog(pool: &PgPool) {
    // Set
    sqlx::query(
        "INSERT INTO sets (code, name) VALUES ('tst', 'Test Set')
         ON CONFLICT (code) DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap();

    // Legendary Creature — valid commander, color identity {U}
    sqlx::query(
        "INSERT INTO cards (oracle_id, name, layout, type_line, color_identity, colors)
         VALUES ($1::uuid, 'Test Legend', 'normal',
                 'Legendary Creature — Human Wizard',
                 ARRAY['U']::text[], ARRAY['U']::text[])
         ON CONFLICT (oracle_id) DO NOTHING",
    )
    .bind(LEGEND_ORACLE)
    .execute(pool)
    .await
    .unwrap();

    // Instant — NOT a valid commander.
    sqlx::query(
        "INSERT INTO cards (oracle_id, name, layout, type_line, color_identity, colors)
         VALUES ($1::uuid, 'Test Bolt', 'normal', 'Instant',
                 ARRAY['R']::text[], ARRAY['R']::text[])
         ON CONFLICT (oracle_id) DO NOTHING",
    )
    .bind(INSTANT_ORACLE)
    .execute(pool)
    .await
    .unwrap();

    // Second legendary creature for partner / color-identity union tests
    // (color identity {G}).
    sqlx::query(
        "INSERT INTO cards (oracle_id, name, layout, type_line, color_identity, colors)
         VALUES ($1::uuid, 'Test Partner', 'normal',
                 'Legendary Creature — Elf Druid',
                 ARRAY['G']::text[], ARRAY['G']::text[])
         ON CONFLICT (oracle_id) DO NOTHING",
    )
    .bind(SECOND_LEGEND_ORACLE)
    .execute(pool)
    .await
    .unwrap();

    // Printing pinned to the legendary creature.
    sqlx::query(
        "INSERT INTO printings (id, oracle_id, set_code, collector_number, rarity)
         VALUES ($1::uuid, $2::uuid, 'tst', '001', 'mythic')
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(LEGEND_PRINTING)
    .bind(LEGEND_ORACLE)
    .execute(pool)
    .await
    .unwrap();
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
async fn deck_entries_zone_routing_and_collapse(pool: PgPool) {
    seed_minimal_catalog(&pool).await;

    // 1) Create a deck (standard, no commander).
    let (status, body) = send(
        app(pool.clone()),
        Method::POST,
        "/api/decks",
        Some(json!({ "name": "Test Standard Deck", "format": "standard" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    let deck_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["color_identity"], json!([]));

    // 2) POST entry to MAIN.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/decks/{deck_id}/entries"),
        Some(json!({ "oracle_id": LEGEND_ORACLE, "zone": "main", "quantity": 1 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "body: {b}");
    let main_entry_id = b["id"].as_str().unwrap().to_string();
    assert_eq!(b["quantity"], 1);
    assert_eq!(b["zone"], "main");
    assert_eq!(b["oracle_name"], "Test Legend");

    // 3) POST same oracle to SIDE — different zone, must create a new row.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/decks/{deck_id}/entries"),
        Some(json!({ "oracle_id": LEGEND_ORACLE, "zone": "side", "quantity": 2 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(b["zone"], "side");
    assert_eq!(b["quantity"], 2);
    let side_entry_id = b["id"].as_str().unwrap();
    assert_ne!(side_entry_id, main_entry_id);

    // 4) POST again to MAIN with same oracle — must COLLAPSE.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/decks/{deck_id}/entries"),
        Some(json!({ "oracle_id": LEGEND_ORACLE, "zone": "main", "quantity": 1 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(b["id"].as_str().unwrap(), main_entry_id);
    assert_eq!(b["quantity"], 2);

    // 5) Verify there are exactly 2 rows for this deck (main + side).
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM deck_entries WHERE deck_id = $1::uuid")
        .bind(&deck_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(total, 2);

    // 6) PATCH quantity = 0 on main entry → 204 + row deleted.
    let (s, _) = send(
        app(pool.clone()),
        Method::PATCH,
        &format!("/api/decks/{deck_id}/entries/{main_entry_id}"),
        Some(json!({ "quantity": 0 })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let post_delete: i64 =
        sqlx::query_scalar("SELECT count(*) FROM deck_entries WHERE deck_id = $1::uuid")
            .bind(&deck_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(post_delete, 1);

    // 7) GET /decks/{id} returns entries grouped by zone with the survivor.
    let (s, b) = send(
        app(pool.clone()),
        Method::GET,
        &format!("/api/decks/{deck_id}"),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(b["entries"]["main"].as_array().unwrap().len(), 0);
    assert_eq!(b["entries"]["side"].as_array().unwrap().len(), 1);
    assert_eq!(b["entries"]["side"][0]["quantity"], 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn commander_validation_and_color_identity_computation(pool: PgPool) {
    seed_minimal_catalog(&pool).await;

    // 1) Commander deck with a legendary creature → succeeds, identity = {U}.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        "/api/decks",
        Some(json!({
            "name": "Mono-Blue Commander",
            "format": "commander",
            "commander_oracle_id": LEGEND_ORACLE
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "body: {b}");
    assert_eq!(b["color_identity"], json!(["U"]));
    let deck_id = b["id"].as_str().unwrap().to_string();

    // 2) Commander deck with an INSTANT → 400 validation error.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        "/api/decks",
        Some(json!({
            "name": "Invalid Commander Deck",
            "format": "commander",
            "commander_oracle_id": INSTANT_ORACLE
        })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "body: {b}");
    assert!(b["error"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("legendary creature"));

    // 3) Commander deck with a *missing* oracle id → 400 validation error.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        "/api/decks",
        Some(json!({
            "name": "Missing commander",
            "format": "commander",
            "commander_oracle_id": "deadbeef-dead-dead-dead-deaddeafbeef"
        })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(b["error"].as_str().unwrap().contains("not found"));

    // 4) PATCH the valid deck to add a partner — identity should union to {G,U}.
    let (s, b) = send(
        app(pool.clone()),
        Method::PATCH,
        &format!("/api/decks/{deck_id}"),
        Some(json!({ "partner_oracle_id": SECOND_LEGEND_ORACLE })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "body: {b}");
    let mut got: Vec<String> = b["color_identity"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    got.sort();
    assert_eq!(got, vec!["G".to_string(), "U".to_string()]);

    // 5) PATCH a non-commander format with the instant — should NOT validate.
    let (s, b) = send(
        app(pool.clone()),
        Method::POST,
        "/api/decks",
        Some(json!({
            "name": "Standard Deck",
            "format": "standard",
            "commander_oracle_id": INSTANT_ORACLE
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "body: {b}");
    // color_identity still computed from instant card ({R}).
    assert_eq!(b["color_identity"], json!(["R"]));
}

#[sqlx::test(migrations = "./migrations")]
async fn zone_change_collision_returns_409(pool: PgPool) {
    seed_minimal_catalog(&pool).await;

    // Create a deck and two entries (same oracle, different zones).
    let (_, b) = send(
        app(pool.clone()),
        Method::POST,
        "/api/decks",
        Some(json!({ "name": "Zone Collision Test", "format": "standard" })),
    )
    .await;
    let deck_id = b["id"].as_str().unwrap().to_string();

    let (_, b_main) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/decks/{deck_id}/entries"),
        Some(json!({ "oracle_id": LEGEND_ORACLE, "zone": "main", "quantity": 1 })),
    )
    .await;
    let main_id = b_main["id"].as_str().unwrap().to_string();

    let (_, _b_side) = send(
        app(pool.clone()),
        Method::POST,
        &format!("/api/decks/{deck_id}/entries"),
        Some(json!({ "oracle_id": LEGEND_ORACLE, "zone": "side", "quantity": 1 })),
    )
    .await;

    // PATCH the MAIN entry to move into SIDE — collides → 409.
    let (s, b) = send(
        app(pool.clone()),
        Method::PATCH,
        &format!("/api/decks/{deck_id}/entries/{main_id}"),
        Some(json!({ "zone": "side" })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "body: {b}");
    assert!(b["error"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("already exists"));
}
