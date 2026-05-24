/**
 * CardBrowser — reusable filter form + result list for `/cards/search`.
 *
 * Used by:
 *   * `BrowsePage` (the global `/cards` browser, no extra filters)
 *   * `CollectionDetail` (the per-collection Browse tab, with `collectionId`
 *     and an `oracle | printing` grouping toggle)
 *
 * State model:
 *   * Global browse drives filters from `useSearchParams` so the URL stays
 *     shareable (Phase 5 contract).
 *   * Scoped (collection) browse uses local React state — the route is
 *     `/collections/:id`, and we don't want the tab to leak filters into the
 *     URL of the parent page.
 *
 * This component owns NO mutation logic. Clicking a result row navigates to
 * the card detail page; adding to a collection lives in the parent's
 * `CardPicker`-driven form (see `CollectionDetail`).
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, type CardSummary, type SearchParams } from "@/lib/api/client";

const PAGE_SIZE = 50;

const COLORS: Array<{ code: string; label: string }> = [
  { code: "W", label: "White" },
  { code: "U", label: "Blue" },
  { code: "B", label: "Black" },
  { code: "R", label: "Red" },
  { code: "G", label: "Green" },
];

// ---------------------------------------------------------------------------
// Filter state model (pure)
// ---------------------------------------------------------------------------

/** All the user-driven filter values. Page is separate (driven by pagination). */
type CardBrowserFilters = {
  q?: string;
  colors?: string;
  color_identity?: string;
  type_line?: string;
  set_code?: string;
  format?: string;
};

/**
 * Build the `/cards/search` query parameters from local filter state plus
 * any extra scope passed in by the parent (collection_id / grouping / page).
 */
function buildSearchParams(
  filters: CardBrowserFilters,
  extra: {
    page: number;
    collectionId?: string;
    grouping?: "oracle" | "printing";
  },
): SearchParams {
  return {
    q: filters.q || undefined,
    colors: filters.colors || undefined,
    color_identity: filters.color_identity || undefined,
    type_line: filters.type_line || undefined,
    set_code: filters.set_code || undefined,
    format: filters.format || undefined,
    page: extra.page,
    page_size: PAGE_SIZE,
    collection_id: extra.collectionId,
    grouping: extra.grouping,
  };
}

/** Read filter state out of a URLSearchParams (used by the global flow). */
function filtersFromSearchParams(sp: URLSearchParams): CardBrowserFilters {
  return {
    q: sp.get("q") ?? undefined,
    colors: sp.get("colors") ?? undefined,
    color_identity: sp.get("color_identity") ?? undefined,
    type_line: sp.get("type_line") ?? undefined,
    set_code: sp.get("set_code") ?? undefined,
    format: sp.get("format") ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type CardBrowserProps = {
  /** Scope every search to this collection (Phase 8b). */
  collectionId?: string;
  /** Only meaningful when `collectionId` is set. */
  grouping?: "oracle" | "printing";
  /**
   * Optional render override for a result row. When omitted, the default
   * row shows oracle data; when set, the caller can render qty badges,
   * actions, etc. (used by the per-collection browse view).
   */
  renderRow?: (card: CardSummary) => ReactNode;
  /** Optional message shown when the result set is empty. */
  emptyMessage?: ReactNode;
};

export function CardBrowser({
  collectionId,
  grouping,
  renderRow,
  emptyMessage,
}: CardBrowserProps) {
  // Global browse keeps filters in the URL; scoped browse stays local so we
  // don't leak filter state across tabs of the parent route.
  const scoped = Boolean(collectionId);

  // URL-driven state (BrowsePage). React Router's hook is always called; we
  // only USE its values in the global flow, but keeping the hook call
  // unconditional satisfies the rules of hooks.
  const [urlSp, setUrlSp] = useSearchParams();

  // Local state (collection browse).
  const [localFilters, setLocalFilters] = useState<CardBrowserFilters>({});
  const [localPage, setLocalPage] = useState(1);

  const filters: CardBrowserFilters = scoped
    ? localFilters
    : filtersFromSearchParams(urlSp);

  const page: number = scoped
    ? localPage
    : Math.max(1, Number(urlSp.get("page") ?? "1") || 1);

  const params = useMemo(
    () => buildSearchParams(filters, { page, collectionId, grouping }),
    [filters, page, collectionId, grouping],
  );

  const cardsQuery = useQuery({
    queryKey: scoped
      ? ["collections", collectionId, "browse", { ...filters, grouping, page }]
      : ["cards.search", params],
    queryFn: () => api.cards.search(params),
    placeholderData: keepPreviousData,
  });

  const sets = useQuery({
    queryKey: ["sets.list"],
    queryFn: api.sets.list,
    staleTime: 1000 * 60 * 60,
  });

  // Mutating filters: reset page to 1 whenever any filter changes.
  const update = (patch: Partial<CardBrowserFilters>) => {
    if (scoped) {
      setLocalFilters((prev) => ({ ...prev, ...patch }));
      setLocalPage(1);
      return;
    }
    const next = new URLSearchParams(urlSp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.set("page", "1");
    setUrlSp(next);
  };

  const goToPage = (n: number) => {
    if (scoped) {
      setLocalPage(n);
      return;
    }
    const next = new URLSearchParams(urlSp);
    next.set("page", String(n));
    setUrlSp(next);
  };

  const toggleColor = (key: "colors" | "color_identity", code: string) => {
    const cur = (filters[key] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const has = cur.includes(code);
    const nextList = has ? cur.filter((c) => c !== code) : [...cur, code];
    update({ [key]: nextList.length ? nextList.join(",") : undefined });
  };

  const totalPages = cardsQuery.data
    ? Math.max(1, Math.ceil(cardsQuery.data.total / PAGE_SIZE))
    : 1;

  return (
    <div className="flex flex-col gap-6">
      <form
        className="grid gap-4 rounded-lg border border-border bg-surface-raised p-4 md:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Name
          </span>
          <input
            type="search"
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            placeholder="Lightning Bolt"
            defaultValue={filters.q ?? ""}
            onChange={(e) => update({ q: e.currentTarget.value || undefined })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Type
          </span>
          <input
            type="search"
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            placeholder="Creature, Instant…"
            defaultValue={filters.type_line ?? ""}
            onChange={(e) =>
              update({ type_line: e.currentTarget.value || undefined })
            }
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Set
          </span>
          <select
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg focus:border-border-strong focus:outline-none"
            value={filters.set_code ?? ""}
            onChange={(e) =>
              update({ set_code: e.currentTarget.value || undefined })
            }
          >
            <option value="">All sets</option>
            {sets.data?.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code.toUpperCase()})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Format
          </span>
          <select
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-fg focus:border-border-strong focus:outline-none"
            value={filters.format ?? ""}
            onChange={(e) =>
              update({ format: e.currentTarget.value || undefined })
            }
          >
            <option value="">Any</option>
            <option value="commander">Commander</option>
            <option value="modern">Modern</option>
            <option value="pioneer">Pioneer</option>
            <option value="standard">Standard</option>
            <option value="legacy">Legacy</option>
            <option value="vintage">Vintage</option>
            <option value="pauper">Pauper</option>
          </select>
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Colors
          </legend>
          <div className="flex gap-1">
            {COLORS.map(({ code, label }) => {
              const active = (filters.colors ?? "").split(",").includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => toggleColor("colors", code)}
                  className={[
                    "h-8 w-8 rounded border font-mono text-sm transition-colors",
                    active
                      ? "border-border-strong bg-accent text-accent-fg"
                      : "border-border bg-surface text-fg-subtle hover:text-fg",
                  ].join(" ")}
                >
                  {code}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Color identity
          </legend>
          <div className="flex gap-1">
            {COLORS.map(({ code, label }) => {
              const active = (filters.color_identity ?? "")
                .split(",")
                .includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => toggleColor("color_identity", code)}
                  className={[
                    "h-8 w-8 rounded border font-mono text-sm transition-colors",
                    active
                      ? "border-border-strong bg-accent text-accent-fg"
                      : "border-border bg-surface text-fg-subtle hover:text-fg",
                  ].join(" ")}
                >
                  {code}
                </button>
              );
            })}
          </div>
        </fieldset>
      </form>

      <section
        aria-live="polite"
        className="rounded-lg border border-border bg-surface-raised"
      >
        {cardsQuery.data && (
          <p className="border-b border-border px-4 py-2 font-mono text-xs text-fg-subtle">
            {cardsQuery.data.total.toLocaleString()}{" "}
            {scoped
              ? grouping === "printing"
                ? "entries"
                : "owned cards"
              : "cards"}
          </p>
        )}

        {cardsQuery.isError && (
          <p className="p-6 text-signal-danger">
            Failed to search: {cardsQuery.error.message}
          </p>
        )}

        {cardsQuery.data && cardsQuery.data.items.length === 0 && (
          <div className="p-6 text-fg-muted">
            {emptyMessage ?? "No cards match those filters."}
          </div>
        )}

        {cardsQuery.data && cardsQuery.data.items.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border text-left font-mono text-xs uppercase tracking-widest text-fg-subtle">
              <tr>
                {scoped && <th className="px-4 py-3">Qty</th>}
                <th className="px-4 py-3">Name</th>
                {scoped && grouping === "printing" && (
                  <>
                    <th className="px-4 py-3">Set</th>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Finish</th>
                  </>
                )}
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">CMC</th>
                <th className="px-4 py-3">Identity</th>
                <th className="px-4 py-3">EDHREC</th>
              </tr>
            </thead>
            <tbody>
              {cardsQuery.data.items.map((card, i) => {
                const key = rowKey(card, i);
                return renderRow ? (
                  <RowSlot key={key} child={renderRow(card)} />
                ) : (
                  <DefaultRow
                    key={key}
                    card={card}
                    scoped={scoped}
                    grouping={grouping}
                  />
                );
              })}
            </tbody>
          </table>
        )}

        {cardsQuery.data && cardsQuery.data.total > PAGE_SIZE && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-3 font-mono text-xs">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
              className="rounded border border-border bg-surface px-3 py-1 uppercase tracking-widest text-fg disabled:opacity-40"
            >
              {"\u2190"} Prev
            </button>
            <span className="text-fg-subtle">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
              className="rounded border border-border bg-surface px-3 py-1 uppercase tracking-widest text-fg disabled:opacity-40"
            >
              Next {"\u2192"}
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

/** Stable key for a result row across both grouping modes. */
function rowKey(card: CardSummary, fallbackIndex: number): string {
  // Printing-scoped rows must be keyed by the entry-distinguishing tuple
  // (printing_id × finish × condition) because the same printing can appear
  // multiple times (e.g. nonfoil + foil).
  if (card.printing_id) {
    return `${card.printing_id}|${card.finish ?? ""}|${card.condition ?? ""}|${card.language ?? ""}`;
  }
  return card.oracle_id || String(fallbackIndex);
}

/**
 * Wrap a caller-provided row in a `<tr>` so the column structure remains the
 * caller's concern. If the caller already returns a `<tr>`, we still wrap —
 * that would be invalid HTML; we tell callers to return `<td>` cells.
 */
function RowSlot({ child }: { child: ReactNode }) {
  return <tr className="border-b border-border last:border-0 hover:bg-surface-sunken">{child}</tr>;
}

function DefaultRow({
  card,
  scoped,
  grouping,
}: {
  card: CardSummary;
  scoped: boolean;
  grouping?: "oracle" | "printing";
}) {
  const showPrintingCols = scoped && grouping === "printing";
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-sunken">
      {scoped && (
        <td className="px-4 py-2 font-mono text-xs text-fg">
          {card.owned_quantity != null ? `\u00d7${card.owned_quantity}` : ""}
        </td>
      )}
      <td className="px-4 py-2">
        <Link
          to={`/cards/${card.oracle_id}`}
          className="text-fg hover:underline"
        >
          {card.name}
        </Link>
      </td>
      {showPrintingCols && (
        <>
          <td className="px-4 py-2 font-mono text-xs uppercase tracking-widest text-fg-subtle">
            {card.set_code ?? ""}
          </td>
          <td className="px-4 py-2 font-mono text-xs text-fg-subtle">
            {card.collector_number ?? ""}
          </td>
          <td className="px-4 py-2 font-mono text-xs text-fg-subtle">
            {card.finish ?? ""}
          </td>
        </>
      )}
      <td className="px-4 py-2 text-fg-muted">{card.type_line}</td>
      <td className="px-4 py-2 font-mono text-xs text-fg-muted">
        {card.mana_cost ?? "\u2014"}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-fg-muted">
        {card.mana_value}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-fg-muted">
        {card.color_identity.length ? card.color_identity.join("") : "C"}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-fg-muted">
        {card.edhrec_rank?.toLocaleString() ?? "\u2014"}
      </td>
    </tr>
  );
}
