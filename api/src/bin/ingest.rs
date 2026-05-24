//! tutor-ingest — Scryfall data sync CLI.
//!
//! Subcommands:
//!   sets        fetch /sets and upsert
//!   cards       download oracle_cards bulk, upsert oracle catalog + faces
//!   printings   download default_cards bulk, upsert printings
//!   all         sets, then cards, then printings (in order)
//!
//! Bulk JSON files are cached at $TUTOR_DATA_DIR (default /data/scryfall/) so
//! subsequent runs skip the download if the cached file's mtime matches
//! Scryfall's reported `updated_at`.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use sqlx::PgPool;
use tracing::{info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use tutor_api::scryfall::{self, ScryfallCard, ScryfallClient};

#[derive(Parser)]
#[command(
    name = "tutor-ingest",
    about = "Sync Scryfall data into Tutor's Postgres."
)]
struct Cli {
    #[command(subcommand)]
    cmd: Command,

    /// Database URL. Falls back to $DATABASE_URL.
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    /// Bulk-data cache directory.
    #[arg(long, env = "TUTOR_DATA_DIR", default_value = "data/scryfall")]
    data_dir: PathBuf,
}

#[derive(Subcommand)]
enum Command {
    /// Fetch /sets and upsert.
    Sets,
    /// Download oracle_cards bulk and upsert cards + card_faces.
    Cards {
        /// Force re-download even if a cached file is current.
        #[arg(long)]
        refresh: bool,
    },
    /// Download default_cards bulk and upsert printings.
    Printings {
        #[arg(long)]
        refresh: bool,
    },
    /// Run sets, cards, then printings in order.
    All {
        #[arg(long)]
        refresh: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("info,tutor_api=debug,sqlx=warn,reqwest=warn,hyper=warn")
        }))
        .with(fmt::layer().compact())
        .init();

    let cli = Cli::parse();
    tokio::fs::create_dir_all(&cli.data_dir)
        .await
        .with_context(|| format!("creating data dir {}", cli.data_dir.display()))?;

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(&cli.database_url)
        .await
        .context("connecting to Postgres")?;
    let client = ScryfallClient::new()?;

    match cli.cmd {
        Command::Sets => {
            ingest_sets(&pool, &client).await?;
        }
        Command::Cards { refresh } => {
            ingest_cards(&pool, &client, &cli.data_dir, refresh).await?;
        }
        Command::Printings { refresh } => {
            ingest_printings(&pool, &client, &cli.data_dir, refresh).await?;
        }
        Command::All { refresh } => {
            ingest_sets(&pool, &client).await?;
            ingest_cards(&pool, &client, &cli.data_dir, refresh).await?;
            ingest_printings(&pool, &client, &cli.data_dir, refresh).await?;
        }
    }

    Ok(())
}

async fn ingest_sets(pool: &PgPool, client: &ScryfallClient) -> Result<()> {
    info!("fetching /sets …");
    let sets = client.sets().await?;
    info!(count = sets.len(), "upserting sets");
    let n = scryfall::import::upsert_sets(pool, &sets).await?;
    info!(upserted = n, "sets done");
    Ok(())
}

async fn ingest_cards(
    pool: &PgPool,
    client: &ScryfallClient,
    data_dir: &Path,
    refresh: bool,
) -> Result<()> {
    let path = ensure_bulk(client, data_dir, "oracle_cards", refresh).await?;
    info!(path = %path.display(), "loading oracle_cards bulk");
    let cards: Vec<ScryfallCard> = read_bulk(&path).context("parsing oracle_cards bulk")?;
    info!(count = cards.len(), "upserting oracle catalog + faces");

    let pb = ProgressBar::new(cards.len() as u64);
    pb.set_style(progress_style());
    let mut done = 0usize;
    let chunk_size = 500;
    for chunk in cards.chunks(chunk_size) {
        let n = scryfall::import::upsert_oracle_cards(pool, chunk).await?;
        done += n;
        pb.inc(chunk.len() as u64);
    }
    pb.finish_with_message("done");
    info!(upserted = done, "cards done");
    Ok(())
}

async fn ingest_printings(
    pool: &PgPool,
    client: &ScryfallClient,
    data_dir: &Path,
    refresh: bool,
) -> Result<()> {
    let path = ensure_bulk(client, data_dir, "default_cards", refresh).await?;
    info!(path = %path.display(), "loading default_cards bulk");
    let cards: Vec<ScryfallCard> = read_bulk(&path).context("parsing default_cards bulk")?;
    info!(count = cards.len(), "upserting printings");

    let pb = ProgressBar::new(cards.len() as u64);
    pb.set_style(progress_style());
    let mut done = 0usize;
    let chunk_size = 500;
    for chunk in cards.chunks(chunk_size) {
        let n = scryfall::import::upsert_printings(pool, chunk).await?;
        done += n;
        pb.inc(chunk.len() as u64);
    }
    pb.finish_with_message("done");
    info!(upserted = done, "printings done");
    Ok(())
}

/// Ensure a bulk file is present on disk; download if missing or stale or
/// `refresh` is set. Returns the local path.
async fn ensure_bulk(
    client: &ScryfallClient,
    data_dir: &Path,
    kind: &str,
    refresh: bool,
) -> Result<PathBuf> {
    let entry = client.bulk_data_of_kind(kind).await?;
    let path = data_dir.join(format!("{kind}.json"));
    let stamp = data_dir.join(format!("{kind}.updated_at"));

    let cached_ts = tokio::fs::read_to_string(&stamp).await.ok();
    let cached_ok = !refresh
        && path.exists()
        && cached_ts
            .as_deref()
            .map(|s| s.trim() == entry.updated_at.to_rfc3339())
            .unwrap_or(false);

    if cached_ok {
        info!(path = %path.display(), updated_at = %entry.updated_at, "using cached bulk file");
        return Ok(path);
    }

    info!(uri = %entry.download_uri, size = entry.size, "downloading bulk file");
    client.download_to(&entry.download_uri, &path).await?;
    tokio::fs::write(&stamp, entry.updated_at.to_rfc3339()).await?;
    Ok(path)
}

fn read_bulk(path: &Path) -> Result<Vec<ScryfallCard>> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let parsed: Vec<ScryfallCard> =
        serde_json::from_slice(&bytes).with_context(|| format!("parsing {}", path.display()))?;
    if parsed.is_empty() {
        warn!(path = %path.display(), "bulk file parsed empty");
    }
    Ok(parsed)
}

fn progress_style() -> ProgressStyle {
    ProgressStyle::with_template(
        "{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos:>7}/{len:7} {msg}",
    )
    .expect("static progress template")
    .progress_chars("=>-")
}
