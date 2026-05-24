import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, type SearchParams } from "@/lib/api/client";

const PAGE_SIZE = 50;
const COLORS: Array<{ code: string; label: string }> = [
  { code: "W", label: "White" },
  { code: "U", label: "Blue" },
  { code: "B", label: "Black" },
  { code: "R", label: "Red" },
  { code: "G", label: "Green" },
];

function paramsFromSearch(sp: URLSearchParams): SearchParams {
  const pageRaw = Number(sp.get("page") ?? "1");
  return {
    q: sp.get("q") ?? undefined,
    colors: sp.get("colors") ?? undefined,
    color_identity: sp.get("color_identity") ?? undefined,
    type_line: sp.get("type_line") ?? undefined,
    set_code: sp.get("set_code") ?? undefined,
    format: sp.get("format") ?? undefined,
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    page_size: PAGE_SIZE,
  };
}

export function BrowsePage() {
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => paramsFromSearch(sp), [sp]);

  const cards = useQuery({
    queryKey: ["cards.search", params],
    queryFn: () => api.cards.search(params),
    placeholderData: keepPreviousData,
  });

  const sets = useQuery({
    queryKey: ["sets.list"],
    queryFn: api.sets.list,
    staleTime: 1000 * 60 * 60,
  });

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.set("page", "1");
    setSp(next);
  };

  const toggleColor = (key: "colors" | "color_identity", code: string) => {
    const cur = (sp.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const has = cur.includes(code);
    const next = has ? cur.filter((c) => c !== code) : [...cur, code];
    update({ [key]: next.length ? next.join(",") : undefined });
  };

  const totalPages = cards.data
    ? Math.max(1, Math.ceil(cards.data.total / PAGE_SIZE))
    : 1;
  const page = params.page ?? 1;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Catalog
          </p>
          <h1 className="font-serif text-3xl text-fg">Browse cards</h1>
        </div>
        {cards.data && (
          <p className="font-mono text-xs text-fg-subtle">
            {cards.data.total.toLocaleString()} cards
          </p>
        )}
      </header>

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
            defaultValue={sp.get("q") ?? ""}
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
            defaultValue={sp.get("type_line") ?? ""}
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
            value={sp.get("set_code") ?? ""}
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
            value={sp.get("format") ?? ""}
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
              const active = (sp.get("colors") ?? "").split(",").includes(code);
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
              const active = (sp.get("color_identity") ?? "")
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
        {cards.isError && (
          <p className="p-6 text-signal-danger">
            Failed to search: {cards.error.message}
          </p>
        )}

        {cards.data && cards.data.items.length === 0 && (
          <p className="p-6 text-fg-muted">No cards match those filters.</p>
        )}

        {cards.data && cards.data.items.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border text-left font-mono text-xs uppercase tracking-widest text-fg-subtle">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">CMC</th>
                <th className="px-4 py-3">Identity</th>
                <th className="px-4 py-3">EDHREC</th>
              </tr>
            </thead>
            <tbody>
              {cards.data.items.map((c) => (
                <tr
                  key={c.oracle_id}
                  className="border-b border-border last:border-0 hover:bg-surface-sunken"
                >
                  <td className="px-4 py-2">
                    <Link
                      to={`/cards/${c.oracle_id}`}
                      className="text-fg hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-fg-muted">{c.type_line}</td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">
                    {c.mana_cost ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">
                    {c.mana_value}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">
                    {c.color_identity.length ? c.color_identity.join("") : "C"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">
                    {c.edhrec_rank?.toLocaleString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {cards.data && cards.data.total > PAGE_SIZE && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-3 font-mono text-xs">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
              className="rounded border border-border bg-surface px-3 py-1 uppercase tracking-widest text-fg disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-fg-subtle">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => update({ page: String(page + 1) })}
              className="rounded border border-border bg-surface px-3 py-1 uppercase tracking-widest text-fg disabled:opacity-40"
            >
              Next →
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}
