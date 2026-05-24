SHELL := /bin/bash

# Load .env if present so DATABASE_URL etc. flow to recipes.
ifneq (,$(wildcard .env))
include .env
export
endif

API_DIR := api
WEB_DIR := web

.PHONY: help bootstrap db-up db-down db-logs db-reset api web dev migrate codegen \
        test test-api test-web lint lint-api lint-web fmt fmt-api typecheck clean

help:
	@echo "Tutor — available targets"
	@echo ""
	@echo "  make bootstrap     install web deps (pnpm)"
	@echo "  make db-up         start postgres in docker"
	@echo "  make db-down       stop postgres"
	@echo "  make db-reset      destroy and recreate the postgres volume"
	@echo "  make api           run the rust api (cargo run)"
	@echo "  make web           run the vite dev server"
	@echo "  make dev           db-up + api + web concurrently"
	@echo "  make migrate       run sqlx migrations once via the api binary"
	@echo "  make codegen       regenerate the typed web client from openapi.json"
	@echo "  make test          run cargo test + vitest"
	@echo "  make lint          cargo clippy + eslint"
	@echo "  make fmt           cargo fmt"
	@echo "  make typecheck     tsc --noEmit"
	@echo "  make clean         cargo clean + remove web/dist"

bootstrap:
	cd $(WEB_DIR) && pnpm install

db-up:
	docker compose up -d postgres
	@echo "Waiting for postgres to become healthy..."
	@until docker compose exec -T postgres pg_isready -U tutor -d tutor >/dev/null 2>&1; do sleep 1; done
	@echo "Postgres is ready."

db-down:
	docker compose down

db-logs:
	docker compose logs -f postgres

db-reset:
	docker compose down -v
	$(MAKE) db-up

api: db-up
	cd $(API_DIR) && cargo run

web:
	cd $(WEB_DIR) && pnpm dev

dev: db-up
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(API_DIR) && cargo run) & \
	(cd $(WEB_DIR) && pnpm dev) & \
	wait

migrate: db-up
	@echo "Migrations run automatically on API startup via sqlx::migrate!()."
	@echo "Use 'make api' to apply pending migrations and start the server,"
	@echo "or 'make db-reset' to wipe the database and reapply from scratch."

codegen:
	cd $(WEB_DIR) && pnpm codegen

test: test-api test-web

test-api:
	cd $(API_DIR) && cargo test

test-web:
	cd $(WEB_DIR) && pnpm test

lint: lint-api lint-web

lint-api:
	cd $(API_DIR) && cargo clippy --all-targets -- -D warnings

lint-web:
	cd $(WEB_DIR) && pnpm lint

fmt: fmt-api

fmt-api:
	cd $(API_DIR) && cargo fmt

typecheck:
	cd $(WEB_DIR) && pnpm typecheck

clean:
	cd $(API_DIR) && cargo clean
	rm -rf $(WEB_DIR)/dist $(WEB_DIR)/.vite
