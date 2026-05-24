pub mod health;

use crate::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new().merge(health::router())
}
