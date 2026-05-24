import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  COLLECTION_KINDS,
  collections,
  type CollectionKind,
  type CollectionSummary,
  type CreateCollectionBody,
} from "@/lib/api/collections";

const queryKey = ["collections"] as const;

export function CollectionsList() {
  const queryClient = useQueryClient();
  const collectionsQuery = useQuery({
    queryKey,
    queryFn: collections.list,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<CollectionKind>("general");
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: CreateCollectionBody) => collections.create(body),
    onSuccess: async () => {
      setName("");
      setDescription("");
      setKind("general");
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
    createMutation.mutate({
      name: trimmed,
      description: description.trim() ? description.trim() : null,
      kind,
    });
  };

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Tutor / Collections
        </p>
        <h1 className="font-serif text-3xl text-fg">Your collections</h1>
        <p className="text-fg-muted">
          Logical piles of physical cards. Track provenance — when, how, and
          where each card arrived.
        </p>
      </header>

      <section
        aria-labelledby="new-collection-heading"
        className="rounded-lg border border-border bg-surface-raised p-6 shadow"
      >
        <h2
          id="new-collection-heading"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
        >
          New collection
        </h2>
        <form onSubmit={onSubmit} className="mt-4 grid gap-4">
          <label className="grid gap-1">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              placeholder="Main Binder"
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="grid gap-1">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Description (optional)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Notes about this pile."
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="grid gap-1">
            <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
              Kind
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CollectionKind)}
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {COLLECTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          {formError && (
            <p role="alert" className="text-sm text-signal-danger">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="self-start rounded bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-fg shadow-sm transition disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create collection"}
          </button>
        </form>
      </section>

      <section aria-labelledby="all-collections-heading">
        <h2
          id="all-collections-heading"
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle"
        >
          All collections
        </h2>

        <div className="mt-4">
          {collectionsQuery.isPending && (
            <p className="text-fg-muted">Loading…</p>
          )}
          {collectionsQuery.isError && (
            <p className="text-signal-danger" role="alert">
              Failed to load: {collectionsQuery.error.message}
            </p>
          )}
          {collectionsQuery.data && collectionsQuery.data.length === 0 && (
            <p className="text-fg-muted">
              No collections yet. Create one above to get started.
            </p>
          )}
          {collectionsQuery.data && collectionsQuery.data.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface-raised">
              {collectionsQuery.data.map((c) => (
                <CollectionRow key={c.id} collection={c} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function CollectionRow({ collection: c }: { collection: CollectionSummary }) {
  return (
    <li>
      <Link
        to={`/collections/${c.id}`}
        className="flex items-baseline justify-between gap-4 px-4 py-3 transition hover:bg-surface-sunken"
      >
        <div className="flex flex-col gap-1">
          <span className="font-serif text-lg text-fg">{c.name}</span>
          {c.description && (
            <span className="text-sm text-fg-muted">{c.description}</span>
          )}
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            {c.kind}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 text-right font-mono text-xs text-fg-subtle">
          <dt>distinct</dt>
          <dd className="text-fg">{c.distinct_printings}</dd>
          <dt>total qty</dt>
          <dd className="text-fg">{c.total_quantity}</dd>
        </dl>
      </Link>
    </li>
  );
}
