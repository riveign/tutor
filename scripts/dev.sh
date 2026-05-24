#!/usr/bin/env bash
# Boot the full local stack: Postgres (Docker) + Axum API + Vite web.
#
# Usage:   ./scripts/dev.sh
# Hit Ctrl+C to shut the API + web down. Postgres keeps running so the
# next start is instant; tear it down with `docker compose down` when done.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load .env if the user has one; otherwise fall back to .env.example defaults.
if [[ -f .env ]]; then
  set -a; source .env; set +a
elif [[ -f .env.example ]]; then
  set -a; source .env.example; set +a
fi

: "${DATABASE_URL:=postgres://tutor:tutor@localhost:55432/tutor}"
: "${API_BIND:=0.0.0.0:8080}"
export DATABASE_URL API_BIND

API_PID=""
WEB_PID=""

cleanup() {
  echo
  echo "[dev] shutting down…"
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] ensuring Postgres is up…"
docker compose up -d postgres >/dev/null

echo "[dev] waiting for Postgres to accept connections…"
until docker compose exec -T postgres pg_isready -U tutor -d tutor >/dev/null 2>&1; do
  sleep 1
done

echo "[dev] starting Axum API on $API_BIND…"
(cd api && cargo run --quiet --bin tutor-api) &
API_PID=$!

echo "[dev] waiting for API health…"
until curl -sf "http://${API_BIND/0.0.0.0/localhost}/api/health" >/dev/null 2>&1; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[dev] API exited before becoming healthy" >&2
    exit 1
  fi
  sleep 1
done
echo "[dev] API ready → http://${API_BIND/0.0.0.0/localhost}"
echo "[dev]   docs   → http://${API_BIND/0.0.0.0/localhost}/docs"

echo "[dev] starting Vite on http://localhost:5173…"
(cd web && npm run dev) &
WEB_PID=$!

wait "$WEB_PID"
