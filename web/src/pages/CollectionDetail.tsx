import { useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import {
  AddCardLeftPane,
  type AddCardLeftPaneHandle,
} from "@/components/AddCardLeftPane";
import { CardBrowser } from "@/components/CardBrowser";
import type { CardPickerHighlight } from "@/components/CardPicker";
import {
  CardPreview,
  type CardPreviewConfirmPayload,
} from "@/components/CardPreview";
import {
  collections,
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
/**
 * Query-key prefix for the per-collection browse view. Any mutation that
 * changes which printings the user owns (or how many) must invalidate this
 * prefix so the Browse tab picks up the change after a switch.
 */
function browseKey(id: string): QueryKey {
  return ["collections", id, "browse"];
}

type CollectionTab = "entries" | "browse";

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

  // Tab state is intentionally LOCAL (not URL-driven) — the "Browse" tab
  // owns its own filter state inside `CardBrowser`, and we don't want either
  // tab to leak filters into the parent route's URL.
  const [tab, setTab] = useState<CollectionTab>("entries");

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          <Link to="/collections" className="hover:underline">
            Collections
          </Link>
          {" / "}
          {collectionQuery.data?.name ?? "\u2026"}
        </p>
        <CollectionHeader query={collectionQuery} />
      </header>

      <TabSwitcher value={tab} onChange={setTab} />

      {tab === "entries" && <EntriesTabPanel id={id} />}
      {tab === "browse" && (
        <BrowseTabPanel id={id} onSwitchToEntries={() => setTab("entries")} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tab switcher
// ---------------------------------------------------------------------------

/**
 * Simple two-option segmented control. Implemented as a `role="tablist"` so
 * arrow-key navigation and aria semantics work without a heavyweight library.
 */
function TabSwitcher({
  value,
  onChange,
}: {
  value: CollectionTab;
  onChange: (next: CollectionTab) => void;
}) {
  const options: Array<{ key: CollectionTab; label: string }> = [
    { key: "entries", label: "Entries" },
    { key: "browse", label: "Browse" },
  ];
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = options.findIndex((o) => o.key === value);
    const next = options[(idx + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
    if (next) onChange(next.key);
  };

  return (
    <div
      role="tablist"
      aria-label="Collection view"
      onKeyDown={onKeyDown}
      className="inline-flex rounded-lg border border-border bg-surface-raised p-1"
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.key)}
            className={[
              "rounded px-4 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-fg-subtle hover:text-fg",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entries tab panel
// ---------------------------------------------------------------------------

function EntriesTabPanel({ id }: { id: string }) {
  const entriesQuery = useQuery({
    queryKey: entriesKey(id),
    queryFn: () => collections.listEntries(id, 1, 200),
  });

  return (
    <div className="flex flex-col gap-10" role="tabpanel" aria-label="Entries">
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
            <p className="text-fg-muted">Loading entries{"\u2026"}</p>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse tab panel (Phase 8b)
// ---------------------------------------------------------------------------

function BrowseTabPanel({
  id,
  onSwitchToEntries,
}: {
  id: string;
  onSwitchToEntries: () => void;
}) {
  // Local toggle — Phase 8b deliberately keeps grouping out of the URL.
  const [grouping, setGrouping] = useState<"oracle" | "printing">("oracle");

  return (
    <div className="flex flex-col gap-4" role="tabpanel" aria-label="Browse">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Browse your collection
        </h2>
        <GroupingToggle value={grouping} onChange={setGrouping} />
      </div>

      <CardBrowser
        collectionId={id}
        grouping={grouping}
        emptyMessage={
          <span>
            No cards yet{" \u2014 "}
            <button
              type="button"
              onClick={onSwitchToEntries}
              className="font-mono text-xs uppercase tracking-widest text-fg underline hover:no-underline"
            >
              add some via the Entries tab
            </button>
            .
          </span>
        }
      />
    </div>
  );
}

/** Oracle / Printing radio-group as a pair of buttons. */
function GroupingToggle({
  value,
  onChange,
}: {
  value: "oracle" | "printing";
  onChange: (next: "oracle" | "printing") => void;
}) {
  const options: Array<{ key: "oracle" | "printing"; label: string }> = [
    { key: "oracle", label: "Oracle" },
    { key: "printing", label: "Printing" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Group results by"
      className="inline-flex rounded border border-border bg-surface"
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            className={[
              "px-3 py-1 font-mono text-xs uppercase tracking-widest transition-colors",
              active
                ? "bg-accent text-accent-fg"
                : "text-fg-subtle hover:text-fg",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
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
// Add-entry section — split pane (Phase 8c)
//
// Left pane: keyboard-driven CardPicker (search + arrow-key highlight).
// Right pane: live CardPreview of the currently HIGHLIGHTED row (image, name,
// oracle text, finish/qty/condition inputs, Confirm).
//
// The preview deliberately persists after a successful add — only the form
// fields reset, the selection stays. That makes repeat-adds of the same card
// a single Tab+Enter.
// ---------------------------------------------------------------------------

function AddEntrySection({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const leftPaneRef = useRef<AddCardLeftPaneHandle>(null);

  // The currently highlighted oracle row in the picker. `null` while the
  // input is empty or no results.
  const [highlight, setHighlight] = useState<CardPickerHighlight | null>(null);
  // Bumped on every successful add — tells CardPreview to flash + reset form,
  // and the left pane to clear/refocus its mode-appropriate input.
  const [flashCounter, setFlashCounter] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: CreateEntryBody) => collections.createEntry(id, body),
    onSuccess: async () => {
      setError(null);
      setFlashCounter((n) => n + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entriesKey(id) }),
        queryClient.invalidateQueries({ queryKey: collectionKey(id) }),
        // Browse tab caches per-filter — invalidate by prefix so any open
        // filter combination refetches next time the tab is shown.
        queryClient.invalidateQueries({ queryKey: browseKey(id) }),
      ]);
      // Mode-aware refocus. In Name mode the name input regains focus
      // (preview persists for one-tab repeat-adds). In Collector-# mode
      // the number input clears + refocuses (the set persists).
      leftPaneRef.current?.focusForNextAdd();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    },
  });

  const handleConfirm = (payload: CardPreviewConfirmPayload) => {
    // CardPreview produces a fully-validated payload; we just shape it into
    // the API contract (oracle_id isn't sent server-side — printing_id is
    // the authoritative join key).
    addMutation.mutate({
      printing_id: payload.printing_id,
      quantity: payload.quantity,
      finish: payload.finish,
      language: payload.language,
      condition: payload.condition,
      acquired_at: payload.acquired_at,
      acquired_from: payload.acquired_from,
      notes: payload.notes,
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

      <div className="mt-4 grid min-h-[560px] gap-6 md:grid-cols-2">
        {/* Left pane: mode-aware picker + highlight emission. */}
        <div className="flex flex-col gap-2">
          <AddCardLeftPane
            ref={leftPaneRef}
            onHighlight={setHighlight}
            successFlashKey={flashCounter}
          />
          {error && (
            <p role="alert" className="font-mono text-xs text-signal-danger">
              {error}
            </p>
          )}
        </div>

        {/* Right pane: live preview + form */}
        <CardPreview
          selection={highlight}
          onConfirm={handleConfirm}
          isSubmitting={addMutation.isPending}
          successFlashKey={flashCounter}
        />
      </div>
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
      // the parent collection totals + browse cache (Phase 8b).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entriesKey(collectionId) }),
        queryClient.invalidateQueries({ queryKey: collectionKey(collectionId) }),
        queryClient.invalidateQueries({ queryKey: browseKey(collectionId) }),
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
        queryClient.invalidateQueries({ queryKey: browseKey(collectionId) }),
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
