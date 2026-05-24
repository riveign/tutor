/**
 * Typed wrappers around the `/api/collections` endpoints.
 *
 * Types are pulled from the generated OpenAPI `schema.ts`. The thin runtime
 * helper `request` lives in `./client.ts` and handles JSON, base URL, and
 * throwing on non-2xx responses.
 */
import { ApiError, request } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type CollectionSummary = components["schemas"]["CollectionSummary"];
export type CollectionDetail = components["schemas"]["CollectionDetail"];
export type CollectionEntry = components["schemas"]["CollectionEntry"];
export type EntriesPage = components["schemas"]["EntriesPage"];
export type CreateCollectionBody = components["schemas"]["CreateCollectionBody"];
export type UpdateCollectionBody = components["schemas"]["UpdateCollectionBody"];
export type CreateEntryBody = components["schemas"]["CreateEntryBody"];
export type UpdateEntryBody = components["schemas"]["UpdateEntryBody"];
export type CardFinish = components["schemas"]["CardFinish"];
export type CardCondition = components["schemas"]["CardCondition"];

export const FINISHES: CardFinish[] = ["nonfoil", "foil", "etched", "glossy"];
export const CONDITIONS: CardCondition[] = [
  "mint",
  "near_mint",
  "lightly_played",
  "moderately_played",
  "heavily_played",
  "damaged",
];

/** Free-form-ish, but these are the canonical kinds the seed UI exposes. */
export const COLLECTION_KINDS = [
  "general",
  "sealed_pool",
  "draft_pool",
  "cube",
  "trade_binder",
  "bulk",
] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export const collections = {
  list: () => request<CollectionSummary[]>("/collections"),

  get: (id: string) => request<CollectionDetail>(`/collections/${id}`),

  create: (body: CreateCollectionBody) =>
    request<CollectionDetail>("/collections", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  update: (id: string, body: UpdateCollectionBody) =>
    request<CollectionDetail>(`/collections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/collections/${id}`, { method: "DELETE" }),

  listEntries: (id: string, page = 1, pageSize = 50) =>
    request<EntriesPage>(
      `/collections/${id}/entries?page=${page}&page_size=${pageSize}`,
    ),

  createEntry: (id: string, body: CreateEntryBody) =>
    request<CollectionEntry>(`/collections/${id}/entries`, {
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
    body: UpdateEntryBody,
  ): Promise<CollectionEntry | null> => {
    return await request<CollectionEntry | null>(
      `/collections/${id}/entries/${entryId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  removeEntry: (id: string, entryId: string) =>
    request<void>(`/collections/${id}/entries/${entryId}`, {
      method: "DELETE",
    }),
};

export { ApiError };
