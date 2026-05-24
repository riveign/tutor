import type { components, operations } from "./schema";

export type HealthResponse = components["schemas"]["HealthStatus"];
export type CardSummary = components["schemas"]["CardSummary"];
export type CardDetail = components["schemas"]["CardDetail"];
export type SearchResponse = components["schemas"]["SearchResponse"];
export type SetSummary = components["schemas"]["SetSummary"];

export type SearchParams = NonNullable<
  operations["search_cards"]["parameters"]["query"]
>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const contentType = res.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed (${res.status})`, res.status, body);
  }

  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (entries.length === 0) return "";
  const search = new URLSearchParams();
  for (const [k, v] of entries) search.set(k, String(v));
  return `?${search.toString()}`;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  cards: {
    search: (params: SearchParams) =>
      request<SearchResponse>(`/cards/search${qs(params)}`),
    get: (oracleId: string) =>
      request<CardDetail>(`/cards/${encodeURIComponent(oracleId)}`),
  },
  sets: {
    list: () => request<SetSummary[]>("/sets"),
  },
};
