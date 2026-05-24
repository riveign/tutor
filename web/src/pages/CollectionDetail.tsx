import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import {
  CardPicker,
  type CardPickerHandle,
  type CardPickerSelection,
} from "@/components/CardPicker";
import {
  CONDITIONS,
  FINISHES,
  collections,
  type CardCondition,
  type CardFinish,
  type CollectionDetail,
  type CollectionEntry,
  type CreateEntryBody,
  type EntriesPage,
  type UpdateEntryBody,
} from "@/lib/api/collections";

function collectionKey(id: string): QueryKey {
  return ["collections", id];
}
function entriesKey(id: string): QueryKey {
  return ["collections", id, "entries"];
}

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-signal-danger" role="alert">
          Missing collection id in URL.
        </p>
      </main>
    );
  }

  return <CollectionDetailInner id={id} />;
}

function CollectionDetailInner({ id }: { id: string }) {
  const collectionQuery = useQuery({
    queryKey: collectionKey(id),
    queryFn: () => collections.get(id),
  });

  const entriesQuery = useQuery({
    queryKey: entriesKey(id),
    queryFn: () => collections.listEntries(id, 1, 200),
  });

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          <Link to="/collections" className="hover:underline">
            Collections
          </Link>
          {" / "}
          {collectionQuery.data?.name ?? "…"}
        </p>
        <CollectionHeader query={collectionQuery} />
      </header>

      <AddEntrySection id={id} />

      <section aria-labelledby="entries-heading">
        <h2
          id="entries-heading"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
        >
          Entries
        </h2>

        <div className="mt-4">
          {entriesQuery.isPending && (
            <p className="text-fg-muted">Loading entries…</p>
          )}
          {entriesQuery.isError && (
            <p className="text-signal-danger" role="alert">
              Failed: {entriesQuery.error.message}
            </p>
          )}
          {entriesQuery.data && entriesQuery.data.items.length === 0 && (
            <p className="text-fg-muted">
              No entries yet. Use the form above to add the first one.
            </p>
          )}
          {entriesQuery.data && entriesQuery.data.items.length > 0 && (
            <EntriesTable
              id={id}
              entries={entriesQuery.data.items}
              total={entriesQuery.data.total}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function CollectionHeader({
  query,
}: {
  query: ReturnType<typeof useQuery<CollectionDetail>>;
}) {
  if (query.isPending) return <p className="text-fg-muted">Loading…</p>;
  if (query.isError)
    return (
      <p className="text-signal-danger" role="alert">
        Failed to load collection: {query.error.message}
      </p>
    );

  const c = query.data;
  if (!c) return null;

  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-serif text-3xl text-fg">{c.name}</h1>
      {c.description && (
        <p className="text-fg-muted">{c.description}</p>
      )}
      <dl className="flex gap-6 font-mono text-xs text-fg-subtle">
        <div>
          <dt>kind</dt>
          <dd className="text-fg">{c.kind}</dd>
        </div>
        <div>
          <dt>distinct printings</dt>
          <dd className="text-fg">{c.distinct_printings}</dd>
        </div>
        <div>
          <dt>total quantity</dt>
          <dd className="text-fg">{c.total_quantity}</dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-entry form
// ---------------------------------------------------------------------------

/**
 * Pick a sensible default finish for the resolved printing. Most cards are
 * `nonfoil`, but some printings (e.g. foil-only promos) only ship as `foil`,
 * so we fall back to whatever is available.
 */
function defaultFinishFor(available: CardFinish[]): CardFinish {
  if (available.includes("nonfoil")) return "nonfoil";
  if (available.length > 0 && available[0]) return available[0];
  // Empty list shouldn't happen for real printings, but stay safe.
  return "nonfoil";
}

// Type guards over the canonical enums — preferred over `as` casts in
// onChange handlers, per the project's TS guidelines.
function isCardFinish(value: string): value is CardFinish {
  return (FINISHES as readonly string[]).includes(value);
}

function isCardCondition(value: string): value is CardCondition {
  return (CONDITIONS as readonly string[]).includes(value);
}

function AddEntrySection({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const pickerRef = useRef<CardPickerHandle>(null);

  // Resolved printing — null until the user picks one. Quantity / finish /
  // language / condition follow once we have a selection.
  const [selection, setSelection] = useState<CardPickerSelection | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [language, setLanguage] = useState("en");
  const [condition, setCondition] = useState<CardCondition>("near_mint");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Auto-dismiss the "Added: X" confirmation after ~2s.
  useEffect(() => {
    if (!lastAdded) return;
    const t = window.setTimeout(() => setLastAdded(null), 2000);
    return () => window.clearTimeout(t);
  }, [lastAdded]);

  const resetToIdle = () => {
    setSelection(null);
    setQuantity(1);
    setFinish("nonfoil");
    setLanguage("en");
    setCondition("near_mint");
    setAcquiredAt("");
    setAcquiredFrom("");
    setNotes("");
    setMoreOpen(false);
  };

  const addMutation = useMutation({
    mutationFn: (body: CreateEntryBody) => collections.createEntry(id, body),
    onSuccess: async (created) => {
      setError(null);
      setLastAdded(`${created.printing_name} ×${created.quantity}`);
      resetToIdle();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entriesKey(id) }),
        queryClient.invalidateQueries({ queryKey: collectionKey(id) }),
      ]);
      // Refocus the search box so the user can immediately type the next
      // card — the core "bulk add" UX promise.
      pickerRef.current?.focus();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    },
  });

  const handlePick = (s: CardPickerSelection) => {
    setSelection(s);
    setQuantity(1);
    setFinish(defaultFinishFor(s.available_finishes));
    setLanguage("en");
    setCondition("near_mint");
    setError(null);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selection) {
      setError("Pick a card first.");
      return;
    }
    if (quantity < 1) {
      setError("Quantity must be at least 1.");
      return;
    }
    addMutation.mutate({
      printing_id: selection.printing_id,
      quantity,
      finish,
      language: language.trim() || "en",
      condition,
      acquired_at: acquiredAt || null,
      acquired_from: acquiredFrom.trim() || null,
      notes: notes.trim() || null,
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
        Add card
      </h2>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <CardPicker ref={pickerRef} onSelect={handlePick} autoFocus />

        {selection && (
          <div className="grid gap-4 md:grid-cols-3">
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

            <label className="grid gap-1">
              <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                Finish
              </span>
              <select
                value={finish}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isCardFinish(v)) setFinish(v);
                }}
                className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {FINISHES.map((f) => {
                  const available =
                    selection.available_finishes.length === 0 ||
                    selection.available_finishes.includes(f);
                  return (
                    <option key={f} value={f} disabled={!available}>
                      {f}
                      {available ? "" : " (not printed)"}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                Condition
              </span>
              <select
                value={condition}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isCardCondition(v)) setCondition(v);
                }}
                className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {selection && (
          <details
            open={moreOpen}
            onToggle={(e) => setMoreOpen(e.currentTarget.open)}
            className="rounded border border-border bg-surface px-3 py-2"
          >
            <summary className="cursor-pointer select-none font-mono text-xs uppercase tracking-widest text-fg-subtle">
              More details
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                  Language
                </span>
                <input
                  type="text"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  maxLength={8}
                  className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                  Acquired at
                </span>
                <input
                  type="date"
                  value={acquiredAt}
                  onChange={(e) => setAcquiredAt(e.target.value)}
                  className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                  Acquired from
                </span>
                <input
                  type="text"
                  value={acquiredFrom}
                  onChange={(e) => setAcquiredFrom(e.target.value)}
                  placeholder="LGS, prerelease, trade…"
                  className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </label>

              <label className="grid gap-1">
                <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                  Notes
                </span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </label>
            </div>
          </details>
        )}

        {selection && (
          <p
            className="font-mono text-xs text-fg-subtle"
            data-testid="add-entry-preview"
          >
            Adding:{" "}
            <span className="text-fg">{selection.name}</span> ·{" "}
            <span className="uppercase tracking-widest">
              {selection.set_code}
            </span>{" "}
            · #{selection.collector_number} · {quantity}× {finish}{" "}
            {condition.replace("_", " ")}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-signal-danger">
            {error}
          </p>
        )}

        {lastAdded && !error && (
          <p
            role="status"
            aria-live="polite"
            className="font-mono text-xs text-signal-success"
          >
            Added: {lastAdded}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={addMutation.isPending || !selection}
            className="rounded bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-fg shadow-sm transition disabled:opacity-50"
          >
            {addMutation.isPending ? "Adding…" : "Add card"}
          </button>
          {selection && (
            <button
              type="button"
              onClick={() => {
                resetToIdle();
                pickerRef.current?.focus();
              }}
              className="rounded border border-border px-3 py-2 font-mono text-xs uppercase tracking-widest text-fg-subtle hover:text-fg"
            >
              Clear
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Entries table (with optimistic update + rollback on per-row mutate/delete)
// ---------------------------------------------------------------------------

function EntriesTable({
  id,
  entries,
  total,
}: {
  id: string;
  entries: CollectionEntry[];
  total: number;
}) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-sunken font-mono text-xs uppercase tracking-widest text-fg-subtle">
          <tr>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Set</th>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Finish</th>
            <th className="px-3 py-2">Condition</th>
            <th className="px-3 py-2">Acquired</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((e) => (
            <EntryRow key={e.id} collectionId={id} entry={e} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              colSpan={8}
              className="px-3 py-2 text-right font-mono text-xs text-fg-subtle"
            >
              {total} entries
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type MutationContext = { previousPage: EntriesPage | undefined };

function EntryRow({
  collectionId,
  entry,
}: {
  collectionId: string;
  entry: CollectionEntry;
}) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<number>(entry.quantity);

  const patchMutation = useMutation({
    mutationFn: (body: UpdateEntryBody) =>
      collections.updateEntry(collectionId, entry.id, body),

    onMutate: async (body): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: entriesKey(collectionId) });
      const previousPage = queryClient.getQueryData<EntriesPage>(
        entriesKey(collectionId),
      );

      if (previousPage) {
        if (body.quantity === 0) {
          // Optimistic: drop the row immediately.
          queryClient.setQueryData<EntriesPage>(entriesKey(collectionId), {
            ...previousPage,
            items: previousPage.items.filter((r) => r.id !== entry.id),
            total: Math.max(0, previousPage.total - 1),
          });
        } else {
          queryClient.setQueryData<EntriesPage>(entriesKey(collectionId), {
            ...previousPage,
            items: previousPage.items.map((r) =>
              r.id === entry.id
                ? {
                    ...r,
                    quantity: body.quantity ?? r.quantity,
                    finish: body.finish ?? r.finish,
                    condition: body.condition ?? r.condition,
                    language: body.language ?? r.language,
                    notes: body.notes ?? r.notes,
                    acquired_at: body.acquired_at ?? r.acquired_at,
                    acquired_from: body.acquired_from ?? r.acquired_from,
                  }
                : r,
            ),
          });
        }
      }

      return { previousPage };
    },

    onError: (_err, _vars, ctx) => {
      // Rollback to the snapshot we took.
      if (ctx?.previousPage) {
        queryClient.setQueryData(
          entriesKey(collectionId),
          ctx.previousPage,
        );
      }
      // Reset the local quantity input back to the server value too.
      setQty(entry.quantity);
    },

    onSuccess: async () => {
      // Refetch to pick up server-derived fields (updated_at) and refresh
      // the parent collection totals.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entriesKey(collectionId) }),
        queryClient.invalidateQueries({ queryKey: collectionKey(collectionId) }),
      ]);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => collections.removeEntry(collectionId, entry.id),

    onMutate: async (): Promise<MutationContext> => {
      await queryClient.cancelQueries({ queryKey: entriesKey(collectionId) });
      const previousPage = queryClient.getQueryData<EntriesPage>(
        entriesKey(collectionId),
      );
      if (previousPage) {
        queryClient.setQueryData<EntriesPage>(entriesKey(collectionId), {
          ...previousPage,
          items: previousPage.items.filter((r) => r.id !== entry.id),
          total: Math.max(0, previousPage.total - 1),
        });
      }
      return { previousPage };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previousPage) {
        queryClient.setQueryData(
          entriesKey(collectionId),
          ctx.previousPage,
        );
      }
    },

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entriesKey(collectionId) }),
        queryClient.invalidateQueries({ queryKey: collectionKey(collectionId) }),
      ]);
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
      <td className="px-3 py-2 font-mono text-xs uppercase tracking-widest text-fg-subtle">
        {entry.set_code}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
        {entry.collector_number}
      </td>
      <td className="px-3 py-2 text-fg">{entry.printing_name}</td>
      <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
        {entry.finish}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
        {entry.condition}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
        {entry.acquired_at ?? "—"}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          className="rounded border border-border px-2 py-1 font-mono text-xs uppercase tracking-widest text-signal-danger transition hover:bg-surface-sunken disabled:opacity-50"
          aria-label={`Delete entry ${entry.printing_name}`}
        >
          {removeMutation.isPending ? "…" : "Delete"}
        </button>
      </td>
    </tr>
  );
}
