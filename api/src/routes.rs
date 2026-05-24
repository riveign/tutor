pub mod cards;
pub mod health;
pub mod sets;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(health::router())
        .merge(cards::router())
        .merge(sets::router())
}
