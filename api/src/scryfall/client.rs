//! Scryfall HTTP client.
//!
//! Etiquette (https://scryfall.com/docs/api):
//!   - Set a unique User-Agent identifying the app.
//!   - Accept: application/json.
//!   - Insert at least 50–100ms between requests; we use 120ms to be safe.
//!   - Retry 429 with a short backoff.
//!
//! The rate-limit gate is a single shared `Mutex<Instant>`; concurrent calls
//! serialize through it. For bulk downloads we go through `download_bulk()`,
//! which streams to disk in one shot — the live-API gate doesn't apply once
//! we hold the download URI.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use reqwest::header::{ACCEPT, USER_AGENT};
use reqwest::StatusCode;
use tokio::sync::Mutex;
use tracing::{debug, warn};

use super::models::{BulkData, BulkDataList, ScryfallSet, SetList};

const USER_AGENT_STR: &str = concat!(
    "tutor/",
    env!("CARGO_PKG_VERSION"),
    " (deckbuilding companion)"
);
const ACCEPT_JSON: &str = "application/json";
const BASE: &str = "https://api.scryfall.com";
const MIN_GAP: Duration = Duration::from_millis(120);
const MAX_RETRIES: u32 = 3;

#[derive(Clone)]
pub struct ScryfallClient {
    http: reqwest::Client,
    gate: Arc<Mutex<Instant>>,
}

impl ScryfallClient {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT_STR)
            .build()
            .context("building reqwest client")?;
        Ok(Self {
            http,
            // Initialize "last request" to a time in the past so the first
            // request doesn't wait.
            gate: Arc::new(Mutex::new(Instant::now() - MIN_GAP)),
        })
    }

    /// Hold the gate, sleep if needed, then return — the caller proceeds
    /// to issue the request immediately after.
    async fn wait_gate(&self) {
        let mut last = self.gate.lock().await;
        let now = Instant::now();
        let elapsed = now.duration_since(*last);
        if elapsed < MIN_GAP {
            tokio::time::sleep(MIN_GAP - elapsed).await;
        }
        *last = Instant::now();
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T> {
        let mut attempt = 0;
        loop {
            self.wait_gate().await;
            debug!(url, attempt, "GET");
            let resp = self
                .http
                .get(url)
                .header(ACCEPT, ACCEPT_JSON)
                .header(USER_AGENT, USER_AGENT_STR)
                .send()
                .await
                .with_context(|| format!("GET {url}"))?;
            let status = resp.status();
            if status == StatusCode::TOO_MANY_REQUESTS && attempt < MAX_RETRIES {
                attempt += 1;
                let backoff = Duration::from_millis(500 * 2u64.pow(attempt));
                warn!(url, attempt, ?backoff, "rate-limited, retrying");
                tokio::time::sleep(backoff).await;
                continue;
            }
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                bail!("GET {url} → {status}: {body}");
            }
            let parsed = resp
                .json::<T>()
                .await
                .with_context(|| format!("decoding response from {url}"))?;
            return Ok(parsed);
        }
    }

    /// Fetch the full list of sets.
    pub async fn sets(&self) -> Result<Vec<ScryfallSet>> {
        let list: SetList = self.get_json(&format!("{BASE}/sets")).await?;
        Ok(list.data)
    }

    /// Fetch the bulk-data index.
    pub async fn bulk_data(&self) -> Result<Vec<BulkData>> {
        let list: BulkDataList = self.get_json(&format!("{BASE}/bulk-data")).await?;
        Ok(list.data)
    }

    /// Find a bulk-data entry by its `type` field (e.g. "oracle_cards",
    /// "default_cards").
    pub async fn bulk_data_of_kind(&self, kind: &str) -> Result<BulkData> {
        let entries = self.bulk_data().await?;
        entries
            .into_iter()
            .find(|b| b.kind == kind)
            .with_context(|| format!("no bulk-data entry with type = {kind}"))
    }

    /// Stream-download a bulk JSON file to disk. The bulk endpoints are not
    /// gated by the live-API rate limit, but we still respect the gate
    /// before *initiating* the request.
    pub async fn download_to<P: AsRef<std::path::Path>>(&self, uri: &str, dest: P) -> Result<()> {
        use futures::StreamExt;
        use tokio::io::AsyncWriteExt;

        self.wait_gate().await;
        debug!(uri, dest = ?dest.as_ref(), "downloading bulk file");
        let resp = self
            .http
            .get(uri)
            .header(USER_AGENT, USER_AGENT_STR)
            .send()
            .await
            .with_context(|| format!("GET {uri}"))?
            .error_for_status()
            .with_context(|| format!("status from {uri}"))?;

        if let Some(parent) = dest.as_ref().parent() {
            tokio::fs::create_dir_all(parent).await.ok();
        }
        let mut file = tokio::fs::File::create(&dest)
            .await
            .with_context(|| format!("creating {}", dest.as_ref().display()))?;

        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("reading bulk download stream")?;
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        Ok(())
    }
}
