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
