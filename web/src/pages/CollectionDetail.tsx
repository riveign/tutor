import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

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

function AddEntrySection({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [printingId, setPrintingId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [language, setLanguage] = useState("en");
  const [condition, setCondition] = useState<CardCondition>("near_mint");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: CreateEntryBody) => collections.createEntry(id, body),
    onSuccess: async () => {
      setError(null);
      setPrintingId("");
      setQuantity(1);
      setAcquiredAt("");
      setAcquiredFrom("");
      setNotes("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entriesKey(id) }),
        queryClient.invalidateQueries({ queryKey: collectionKey(id) }),
      ]);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const pid = printingId.trim();
    if (!pid) {
      setError("printing_id is required (paste a UUID from /printings).");
      return;
    }
    if (quantity < 1) {
      setError("quantity must be at least 1.");
      return;
    }
    addMutation.mutate({
      printing_id: pid,
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
        Add entry
      </h2>
      <form onSubmit={onSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 md:col-span-2">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Printing ID (UUID)
          </span>
          <input
            type="text"
            value={printingId}
            onChange={(e) => setPrintingId(e.target.value)}
            placeholder="e.g. 8e7c…"
            required
            className="rounded border border-border bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          />
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

        <label className="grid gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Finish
          </span>
          <select
            value={finish}
            onChange={(e) => setFinish(e.target.value as CardFinish)}
            className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {FINISHES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

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
            Condition
          </span>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as CardCondition)}
            className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
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

        <label className="grid gap-1 md:col-span-2">
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
