//! Scryfall response types. Only the fields we currently consume are
//! deserialized; unknown fields are silently dropped (via serde's default).
//!
//! Reference: <https://scryfall.com/docs/api>

use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

// =============================================================================
// Bulk-data index
// =============================================================================

/// Top-level response shape from `/bulk-data`.
#[derive(Debug, Deserialize)]
pub struct BulkDataList {
    pub data: Vec<BulkData>,
}

/// One bulk-data entry. The two we care about are `type = "oracle_cards"`
/// (oracle catalog) and `type = "default_cards"` (one printing per gameplay
/// card, English-preferred).
#[derive(Debug, Deserialize)]
pub struct BulkData {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub kind: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub uri: String,
    pub download_uri: String,
    pub name: String,
    pub description: String,
    pub size: i64,
    pub content_type: String,
}

// =============================================================================
// Sets
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct SetList {
    pub data: Vec<ScryfallSet>,
}

#[derive(Debug, Deserialize)]
pub struct ScryfallSet {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub set_type: Option<String>,
    #[serde(default)]
    pub released_at: Option<NaiveDate>,
    #[serde(default)]
    pub card_count: Option<i32>,
    #[serde(default)]
    pub icon_svg_uri: Option<String>,
    #[serde(default)]
    pub scryfall_uri: Option<String>,
}

// =============================================================================
// Cards
//
// One Scryfall card object represents a single printing. The `oracle_id`
// identifies its gameplay (oracle) identity; multiple printings share an
// oracle_id. Multi-faced cards have `card_faces` populated.
// =============================================================================

#[derive(Debug, Deserialize, Clone)]
pub struct ScryfallCard {
    /// Scryfall's printing ID.
    pub id: Uuid,
    /// Oracle ID. For most layouts this is on the top-level card; for
    /// reversible cards (layout = "reversible_card") Scryfall puts the
    /// oracle_id on each face instead. We resolve that downstream.
    #[serde(default)]
    pub oracle_id: Option<Uuid>,
    pub name: String,
    pub lang: String,
    pub layout: String,
    #[serde(default)]
    pub mana_cost: Option<String>,
    #[serde(default)]
    pub cmc: Option<f32>,
    #[serde(default)]
    pub color_identity: Vec<String>,
    #[serde(default)]
    pub colors: Option<Vec<String>>,
    /// Absent on a few oddballs (art series, some token printings). Synthesize
    /// from faces or fall back to an empty string when inserting.
    #[serde(default)]
    pub type_line: Option<String>,
    #[serde(default)]
    pub oracle_text: Option<String>,
    #[serde(default)]
    pub power: Option<String>,
    #[serde(default)]
    pub toughness: Option<String>,
    #[serde(default)]
    pub loyalty: Option<String>,
    #[serde(default)]
    pub defense: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub produced_mana: Option<Vec<String>>,
    #[serde(default)]
    pub legalities: Value,
    #[serde(default)]
    pub edhrec_rank: Option<i32>,

    // Printing-specific
    pub set: String,
    pub collector_number: String,
    pub rarity: String,
    #[serde(default)]
    pub released_at: Option<NaiveDate>,
    #[serde(default)]
    pub border_color: Option<String>,
    #[serde(default)]
    pub frame: Option<String>,
    #[serde(default)]
    pub frame_effects: Vec<String>,
    #[serde(default)]
    pub finishes: Vec<String>,
    #[serde(default)]
    pub promo_types: Vec<String>,
    #[serde(default)]
    pub full_art: bool,
    #[serde(default)]
    pub promo: bool,
    #[serde(default)]
    pub variation: bool,
    #[serde(default)]
    pub image_uris: Value,
    #[serde(default)]
    pub prices: Value,
    #[serde(default)]
    pub scryfall_uri: Option<String>,

    #[serde(default)]
    pub card_faces: Vec<ScryfallCardFace>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ScryfallCardFace {
    /// Present on reversible-card faces; absent on transform/MDFC faces.
    #[serde(default)]
    pub oracle_id: Option<Uuid>,
    pub name: String,
    #[serde(default)]
    pub mana_cost: Option<String>,
    #[serde(default)]
    pub type_line: Option<String>,
    #[serde(default)]
    pub oracle_text: Option<String>,
    #[serde(default)]
    pub power: Option<String>,
    #[serde(default)]
    pub toughness: Option<String>,
    #[serde(default)]
    pub loyalty: Option<String>,
    #[serde(default)]
    pub defense: Option<String>,
    #[serde(default)]
    pub colors: Option<Vec<String>>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub flavor_text: Option<String>,
    #[serde(default)]
    pub image_uris: Value,
}

impl ScryfallCard {
    /// Returns the oracle_id, resolving the reversible-card case (oracle_id
    /// lives on the first face) when the top-level field is absent.
    pub fn resolved_oracle_id(&self) -> Option<Uuid> {
        self.oracle_id
            .or_else(|| self.card_faces.first().and_then(|f| f.oracle_id))
    }

    /// Returns a non-empty type_line. Falls back to joining face type_lines
    /// (covers most MDFC/transform variants), then to an empty string for the
    /// few art-series / weird-token rows that have neither.
    pub fn resolved_type_line(&self) -> String {
        if let Some(tl) = self.type_line.as_deref().filter(|s| !s.is_empty()) {
            return tl.to_string();
        }
        let joined: Vec<&str> = self
            .card_faces
            .iter()
            .filter_map(|f| f.type_line.as_deref())
            .filter(|s| !s.is_empty())
            .collect();
        joined.join(" // ")
    }
}
