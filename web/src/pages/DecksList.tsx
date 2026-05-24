import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  DECK_FORMATS,
  decks,
  type CreateDeckBody,
  type DeckFormat,
  type DeckSummary,
} from "@/lib/api/decks";

const queryKey = ["decks"] as const;

export function DecksList() {
  const queryClient = useQueryClient();
  const decksQuery = useQuery({
    queryKey,
    queryFn: decks.list,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<DeckFormat>("commander");
  const [archetype, setArchetype] = useState("");
  const [commanderOracleId, setCommanderOracleId] = useState("");
  const [partnerOracleId, setPartnerOracleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: CreateDeckBody) => decks.create(body),
    onSuccess: async () => {
      setName("");
      setDescription("");
      setArchetype("");
      setCommanderOracleId("");
      setPartnerOracleId("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      setFormError(err instanceof Error ? err.message : "Failed to create");
    },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Name is required.");
      return;
    }
    const cmd = commanderOracleId.trim();
    const partner = partnerOracleId.trim();
    if (partner && !cmd) {
      setFormError("Partner requires a commander.");
      return;
    }
    createMutation.mutate({
      name: trimmed,
      description: description.trim() ? description.trim() : null,
      format,
      archetype: archetype.trim() ? archetype.trim() : null,
      commander_oracle_id: cmd ? cmd : null,
      partner_oracle_id: partner ? partner : null,
    });
  };

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Tutor / Decks
        </p>
        <h1 className="font-serif text-3xl text-fg">Your decks</h1>
        <p className="text-fg-muted">
          Virtual deck lists referenced by oracle id. Pin physical printings
          later from a collection.
        </p>
      </header>

      <section
        aria-labelledby="new-deck-heading"
        className="rounded-lg border border-border bg-surface-raised p-6 shadow"
      >
        <h2
          id="new-deck-heading"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
        >
          New deck
        </h2>
        <form onSubmit={onSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 md:col-span-2">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              placeholder="Atraxa Superfriends"
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="grid gap-1 md:col-span-2">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Description (optional)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Notes about this build."
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="grid gap-1">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Format
            </span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as DeckFormat)}
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {DECK_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Archetype (optional)
            </span>
            <input
              type="text"
              value={archetype}
              onChange={(e) => setArchetype(e.target.value)}
              placeholder="superfriends, +1/+1 counters…"
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="grid gap-1 md:col-span-2">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Commander oracle id (optional UUID)
            </span>
            <input
              type="text"
              value={commanderOracleId}
              onChange={(e) => setCommanderOracleId(e.target.value)}
              placeholder="e.g. 8e7c…"
              className="rounded border border-border bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="grid gap-1 md:col-span-2">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Partner oracle id (optional UUID)
            </span>
            <input
              type="text"
              value={partnerOracleId}
              onChange={(e) => setPartnerOracleId(e.target.value)}
              placeholder="leave blank unless you have a partner pairing"
              className="rounded border border-border bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          {formError && (
            <p role="alert" className="text-sm text-signal-danger md:col-span-2">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="self-start rounded bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-fg shadow-sm transition disabled:opacity-50 md:col-span-2"
          >
            {createMutation.isPending ? "Creating…" : "Create deck"}
          </button>
        </form>
      </section>

      <section aria-labelledby="all-decks-heading">
        <h2
          id="all-decks-heading"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
        >
          All decks
        </h2>

        <div className="mt-4">
          {decksQuery.isPending && <p className="text-fg-muted">Loading…</p>}
          {decksQuery.isError && (
            <p className="text-signal-danger" role="alert">
              Failed to load: {decksQuery.error.message}
            </p>
          )}
          {decksQuery.data && decksQuery.data.length === 0 && (
            <p className="text-fg-muted">
              No decks yet. Create one above to get started.
            </p>
          )}
          {decksQuery.data && decksQuery.data.length > 0 && (
            <DecksTable decks={decksQuery.data} />
          )}
        </div>
      </section>
    </main>
  );
}

function DecksTable({ decks }: { decks: DeckSummary[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-sunken font-mono text-xs uppercase tracking-widest text-fg-subtle">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Format</th>
            <th className="px-3 py-2">Archetype</th>
            <th className="px-3 py-2">Colors</th>
            <th className="px-3 py-2 text-right">Main</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Rows</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {decks.map((d) => (
            <tr key={d.id} className="hover:bg-surface-sunken">
              <td className="px-3 py-2">
                <Link
                  to={`/decks/${d.id}`}
                  className="font-serif text-base text-fg hover:underline"
                >
                  {d.name}
                </Link>
                {d.description && (
                  <p className="mt-0.5 text-xs text-fg-muted">{d.description}</p>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-fg-subtle">
                {d.format ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">
                {d.archetype ?? "—"}
              </td>
              <td className="px-3 py-2">
                <ColorIdentityChips colors={d.color_identity} />
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-fg">
                {d.main_quantity}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-fg">
                {d.total_quantity}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-fg-subtle">
                {d.distinct_entries}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Simple WUBRG chips. Letters only — no glyph fonts in V1. Desktop-first. */
export function ColorIdentityChips({ colors }: { colors: readonly string[] }) {
  if (!colors || colors.length === 0) {
    return (
      <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
        colorless
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {colors.map((c) => (
        <span
          key={c}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface font-mono text-[10px] font-bold uppercase text-fg"
          aria-label={`color identity ${c}`}
        >
          {c}
        </span>
      ))}
    </div>
  );
}
