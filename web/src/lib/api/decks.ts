/**
 * Typed wrappers around the `/api/decks` endpoints.
 *
 * Mirrors the shape of `./collections.ts`. Types come from the generated
 * OpenAPI `schema.ts`. The thin runtime helper `request` lives in `./client.ts`.
 */
import { ApiError, request } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type DeckSummary = components["schemas"]["DeckSummary"];
export type Deck = components["schemas"]["Deck"];
export type DeckEntry = components["schemas"]["DeckEntry"];
export type DeckWithEntries = components["schemas"]["DeckWithEntries"];
export type EntriesByZone = components["schemas"]["EntriesByZone"];
export type CreateDeckBody = components["schemas"]["CreateDeckBody"];
export type UpdateDeckBody = components["schemas"]["UpdateDeckBody"];
export type CreateDeckEntryBody = components["schemas"]["CreateDeckEntryBody"];
export type UpdateDeckEntryBody = components["schemas"]["UpdateDeckEntryBody"];
export type DeckZone = components["schemas"]["DeckZone"];

/** Order matches the visual order of zone sections in the detail page. */
export const DECK_ZONES: DeckZone[] = [
  "command",
  "companion",
  "main",
  "side",
  "maybe",
];

/** The set of formats the New-Deck form exposes. Free-text on the backend; the
 *  UI offers these plus an "other" escape hatch. */
export const DECK_FORMATS = [
  "commander",
  "standard",
  "modern",
  "pioneer",
  "pauper",
  "legacy",
  "vintage",
  "brawl",
  "draft",
  "sealed",
  "other",
] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];

export const decks = {
  list: () => request<DeckSummary[]>("/decks"),

  get: (id: string) => request<DeckWithEntries>(`/decks/${id}`),

  create: (body: CreateDeckBody) =>
    request<Deck>("/decks", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  update: (id: string, body: UpdateDeckBody) =>
    request<Deck>(`/decks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/decks/${id}`, { method: "DELETE" }),

  listEntries: (id: string) => request<DeckEntry[]>(`/decks/${id}/entries`),

  createEntry: (id: string, body: CreateDeckEntryBody) =>
    request<DeckEntry>(`/decks/${id}/entries`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * PATCH with `quantity: 0` deletes the entry server-side and returns 204.
   * Callers should treat a `null` resolution as "deleted, refetch list".
   */
  updateEntry: async (
    id: string,
    entryId: string,
    body: UpdateDeckEntryBody,
  ): Promise<DeckEntry | null> => {
    return await request<DeckEntry | null>(
      `/decks/${id}/entries/${entryId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  removeEntry: (id: string, entryId: string) =>
    request<void>(`/decks/${id}/entries/${entryId}`, {
      method: "DELETE",
    }),
};

export { ApiError };
