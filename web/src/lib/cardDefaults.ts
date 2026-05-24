/**
 * Pure helpers for choosing sensible defaults when previewing / committing
 * a card entry. Kept in its own module so the unit tests don't drag in any
 * React surface, and so component files stay Fast-Refresh-friendly.
 */
import type { CardFinish } from "@/lib/api/collections";

/**
 * Smart default finish for a newly highlighted printing.
 *
 *   * Prefer `nonfoil` — by far the most common.
 *   * Otherwise prefer `foil` — covers foil-only promos.
 *   * Otherwise fall back to the first available finish.
 *   * Empty input returns `nonfoil` as a last-resort default so callers
 *     always have something to render; this shouldn't happen for real
 *     printings ingested from Scryfall.
 */
export function pickDefaultFinish(available: readonly CardFinish[]): CardFinish {
  if (available.includes("nonfoil")) return "nonfoil";
  if (available.includes("foil")) return "foil";
  const first = available[0];
  if (first) return first;
  return "nonfoil";
}

/**
 * Smart default printing for a newly highlighted oracle card.
 *
 * Rule (Phase 8d):
 *   * Prefer the most-recently-released printing that has a `nonfoil`
 *     finish (foil-only promos are not what most users want by default).
 *   * If zero printings carry `nonfoil`, fall back to the most-recently-
 *     released printing regardless of finish.
 *   * Empty input → `null`.
 *
 * `released_at` is an ISO `YYYY-MM-DD` date string — lexicographic sort is
 * the same as chronological sort for that format, so no Date parsing is
 * needed (and ties are deterministic by input order).
 */
export function pickDefaultPrinting<
  T extends { released_at: string | null; finishes: readonly string[] },
>(printings: readonly T[]): T | null {
  if (printings.length === 0) return null;

  // Sort a stable copy descending by released_at. NULL release dates (rare
  // for tracked printings, but possible) sort to the end so they never
  // outrank a dated printing.
  const sorted = [...printings].sort((a, b) => {
    const ad = a.released_at ?? "";
    const bd = b.released_at ?? "";
    if (ad === bd) return 0;
    if (ad === "") return 1;
    if (bd === "") return -1;
    return ad < bd ? 1 : -1;
  });

  const nonfoil = sorted.find((p) => p.finishes.includes("nonfoil"));
  if (nonfoil) return nonfoil;

  return sorted[0] ?? null;
}

/**
 * Normalize a user-typed collector number for an API lookup.
 *
 *   * Trim whitespace.
 *   * Drop a leading run of `0`s (so `"007"` → `"7"`, `"0123a"` → `"123a"`).
 *   * Preserve non-digit suffixes verbatim (`"42★"`, `"123a"`).
 *   * An all-zero input collapses to `"0"` (not the empty string).
 *
 * The original user-typed value should still be shown in the input until
 * cleared — this helper is only for building the request URL.
 */
export function normalizeCollectorNumber(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Strip leading zeros but leave at least one character.
  const stripped = trimmed.replace(/^0+/, "");
  if (stripped === "") return "0";
  return stripped;
}
