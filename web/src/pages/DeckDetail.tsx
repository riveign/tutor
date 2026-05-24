import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import {
  DECK_ZONES,
  decks,
  type CreateDeckEntryBody,
  type Deck,
  type DeckEntry,
  type DeckWithEntries,
  type DeckZone,
  type EntriesByZone,
  type UpdateDeckEntryBody,
} from "@/lib/api/decks";

import { ColorIdentityChips } from "@/pages/DecksList";

function deckKey(id: string): QueryKey {
  return ["decks", id];
}

const ZONE_LABEL: Record<DeckZone, string> = {
  command: "Command",
  companion: "Companion",
  main: "Mainboard",
  side: "Sideboard",
  maybe: "Maybe",
};

export function DeckDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-signal-danger" role="alert">
          Missing deck id in URL.
        </p>
      </main>
    );
  }
  return <DeckDetailInner id={id} />;
}

function DeckDetailInner({ id }: { id: string }) {
  const deckQuery = useQuery({
    queryKey: deckKey(id),
    queryFn: () => decks.get(id),
  });

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          <Link to="/decks" className="hover:underline">
            Decks
          </Link>
          {" / "}
          {deckQuery.data?.deck.name ?? "…"}
        </p>
        <DeckHeader query={deckQuery} />
      </header>

      <AddEntrySection id={id} />

      <section aria-labelledby="entries-heading">
        <h2
          id="entries-heading"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
        >
          Entries
        </h2>

        <div className="mt-4 flex flex-col gap-8">
          {deckQuery.isPending && (
            <p className="text-fg-muted">Loading entries…</p>
          )}
          {deckQuery.isError && (
            <p className="text-signal-danger" role="alert">
              Failed: {deckQuery.error.message}
            </p>
          )}
          {deckQuery.data && (
            <EntriesByZoneView id={id} entries={deckQuery.data.entries} />
          )}
        </div>
      </section>
    </main>
  );
}

function DeckHeader({
  query,
}: {
  query: ReturnType<typeof useQuery<DeckWithEntries>>;
}) {
  if (query.isPending) return <p className="text-fg-muted">Loading…</p>;
  if (query.isError) {
    return (
      <p className="text-signal-danger" role="alert">
        Failed to load deck: {query.error.message}
      </p>
    );
  }
  const data = query.data;
  if (!data) return null;
  const d: Deck = data.deck;

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-serif text-3xl text-fg">{d.name}</h1>
      {d.description && <p className="text-fg-muted">{d.description}</p>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 font-mono text-xs text-fg-subtle">
        <dt>format</dt>
        <dd className="text-fg">{d.format ?? "—"}</dd>
        <dt>archetype</dt>
        <dd className="text-fg">{d.archetype ?? "—"}</dd>
        <dt>colors</dt>
        <dd>
          <ColorIdentityChips colors={d.color_identity} />
        </dd>
        {d.commander_oracle_id && (
          <>
            <dt>commander</dt>
            <dd className="break-all font-mono text-xs text-fg">
              {d.commander_oracle_id}
            </dd>
          </>
        )}
        {d.partner_oracle_id && (
          <>
            <dt>partner</dt>
            <dd className="break-all font-mono text-xs text-fg">
              {d.partner_oracle_id}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add entry form
// ---------------------------------------------------------------------------

function AddEntrySection({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [oracleId, setOracleId] = useState("");
  const [zone, setZone] = useState<DeckZone>("main");
  const [quantity, setQuantity] = useState(1);
  const [printingId, setPrintingId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: CreateDeckEntryBody) => decks.createEntry(id, body),
    onSuccess: async () => {
      setError(null);
      setOracleId("");
      setPrintingId("");
      setNotes("");
      setQuantity(1);
      await queryClient.invalidateQueries({ queryKey: deckKey(id) });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const oid = oracleId.trim();
    if (!oid) {
      setError("oracle_id is required (paste an oracle UUID).");
      return;
    }
    if (quantity < 1) {
      setError("quantity must be at least 1.");
      return;
    }
    addMutation.mutate({
      oracle_id: oid,
      zone,
      quantity,
      printing_id: printingId.trim() ? printingId.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
    });
  };

  return (
    <section
      aria-labelledby="add-entry-heading"
      className="rounded-lg border border-border bg-surface-raised p-6 shadow"
    >
      <h2
        id="add-entry-heading"
        className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
      >
        Add entry
      </h2>
      <form onSubmit={onSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 md:col-span-2">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Oracle ID (UUID)
          </span>
          <input
            type="text"
            value={oracleId}
            onChange={(e) => setOracleId(e.target.value)}
            placeholder="e.g. aaaaaaaa-aaaa-…"
            required
            className="rounded border border-border bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        <label className="grid gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Zone
          </span>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value as DeckZone)}
            className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {DECK_ZONES.map((z) => (
              <option key={z} value={z}>
                {ZONE_LABEL[z]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Quantity
          </span>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        <label className="grid gap-1 md:col-span-2">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Printing ID (optional UUID — pin a specific physical printing)
          </span>
          <input
            type="text"
            value={printingId}
            onChange={(e) => setPrintingId(e.target.value)}
            placeholder="leave blank if unpinned"
            className="rounded border border-border bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        <label className="grid gap-1 md:col-span-2">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Notes (optional)
          </span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="text-sm text-signal-danger md:col-span-2"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={addMutation.isPending}
          className="self-start rounded bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-fg shadow-sm transition disabled:opacity-50 md:col-span-2"
        >
          {addMutation.isPending ? "Adding…" : "Add entry"}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Entries grouped by zone
// ---------------------------------------------------------------------------

function EntriesByZoneView({
  id,
  entries,
}: {
  id: string;
  entries: EntriesByZone;
}) {
  return (
    <div className="flex flex-col gap-8">
      {DECK_ZONES.map((zone) => {
        const rows = entries[zone] ?? [];
        if (rows.length === 0) return null;
        return (
          <ZoneSection key={zone} id={id} zone={zone} rows={rows} />
        );
      })}
      {DECK_ZONES.every((z) => (entries[z] ?? []).length === 0) && (
        <p className="text-fg-muted">
          No entries yet. Use the form above to add the first one.
        </p>
      )}
    </div>
  );
}

function ZoneSection({
  id,
  zone,
  rows,
}: {
  id: string;
  zone: DeckZone;
  rows: DeckEntry[];
}) {
  const total = rows.reduce((acc, r) => acc + r.quantity, 0);
  return (
    <section aria-labelledby={`zone-${zone}`}>
      <h3
        id={`zone-${zone}`}
        className="mb-2 flex items-baseline justify-between font-mono text-xs uppercase tracking-widest text-fg-subtle"
      >
        <span>{ZONE_LABEL[zone]}</span>
        <span>{total} cards</span>
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-sunken font-mono text-xs uppercase tracking-widest text-fg-subtle">
            <tr>
              <th className="px-3 py-2 w-20">Qty</th>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Printing</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <EntryRow key={r.id} deckId={id} entry={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type MutationContext = { previousData: DeckWithEntries | undefined };

function EntryRow({ deckId, entry }: { deckId: string; entry: DeckEntry }) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<number>(entry.quantity);

  const patchMutation = useMutation({
    mutationFn: (body: UpdateDeckEntryBody) =>
      decks.updateEntry(deckId, entry.id, body),

    onMutate: async (body): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: deckKey(deckId) });
      const previousData = queryClient.getQueryData<DeckWithEntries>(
        deckKey(deckId),
      );

      if (previousData) {
        const updated = mapEntries(previousData, (rows) => {
          if (body.quantity === 0) {
            return rows.filter((r) => r.id !== entry.id);
          }
          return rows.map((r) =>
            r.id === entry.id
              ? {
                  ...r,
                  quantity: body.quantity ?? r.quantity,
                  notes: body.notes ?? r.notes,
                }
              : r,
          );
        });
        queryClient.setQueryData(deckKey(deckId), updated);
      }

      return { previousData };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previousData) {
        queryClient.setQueryData(deckKey(deckId), ctx.previousData);
      }
      setQty(entry.quantity);
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deckKey(deckId) });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => decks.removeEntry(deckId, entry.id),

    onMutate: async (): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: deckKey(deckId) });
      const previousData = queryClient.getQueryData<DeckWithEntries>(
        deckKey(deckId),
      );
      if (previousData) {
        const updated = mapEntries(previousData, (rows) =>
          rows.filter((r) => r.id !== entry.id),
        );
        queryClient.setQueryData(deckKey(deckId), updated);
      }
      return { previousData };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previousData) {
        queryClient.setQueryData(deckKey(deckId), ctx.previousData);
      }
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deckKey(deckId) });
    },
  });

  const commitQty = () => {
    if (qty === entry.quantity) return;
    if (qty < 0) {
      setQty(entry.quantity);
      return;
    }
    patchMutation.mutate({ quantity: qty });
  };

  return (
    <tr className="hover:bg-surface-sunken">
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          onBlur={commitQty}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitQty();
            }
          }}
          disabled={patchMutation.isPending}
          className="w-16 rounded border border-border bg-surface px-2 py-1 text-right text-fg focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </td>
      <td className="px-3 py-2 text-fg">
        <div className="flex flex-col">
          <span>{entry.oracle_name}</span>
          <span className="break-all font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
            {entry.oracle_id}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
        {entry.printing_id ? (
          <div className="flex flex-col">
            <span className="uppercase tracking-widest">
              {entry.set_code ?? "—"} {entry.collector_number ?? ""}
            </span>
            <span className="break-all text-[10px]">{entry.printing_id}</span>
          </div>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-sm text-fg-muted">{entry.notes ?? "—"}</td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="rounded border border-border px-2 py-1 font-mono text-xs uppercase tracking-widest text-signal-danger transition hover:bg-surface-sunken disabled:opacity-50"
          aria-label={`Delete entry ${entry.oracle_name}`}
        >
          {removeMutation.isPending ? "…" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a transform to every zone's array in a `DeckWithEntries`. */
function mapEntries(
  data: DeckWithEntries,
  fn: (rows: DeckEntry[]) => DeckEntry[],
): DeckWithEntries {
  const next: EntriesByZone = {
    command: fn(data.entries.command ?? []),
    companion: fn(data.entries.companion ?? []),
    main: fn(data.entries.main ?? []),
    side: fn(data.entries.side ?? []),
    maybe: fn(data.entries.maybe ?? []),
  };
  return { ...data, entries: next };
}
