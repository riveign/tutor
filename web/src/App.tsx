import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
  });

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Tutor / v0.1.0
        </p>
        <h1 className="font-serif text-4xl text-fg">
          Your library&rsquo;s deckbuilding companion.
        </h1>
        <p className="text-fg-muted">
          Search, build, and curate. Brand and product are early — this page
          confirms the API is reachable.
        </p>
      </header>

      <section
        className="rounded-lg border border-border bg-surface-raised p-6 shadow"
        aria-live="polite"
      >
        <h2 className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          API health
        </h2>
        <div className="mt-3">
          {health.isPending && <p className="text-fg-muted">Checking&hellip;</p>}
          {health.isError && (
            <p className="text-signal-danger">
              Unreachable: {health.error.message}
            </p>
          )}
          {health.data && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-sm">
              <dt className="text-fg-subtle">status</dt>
              <dd>{health.data.status}</dd>
              <dt className="text-fg-subtle">db</dt>
              <dd>
                {health.data.db.connected ? "connected" : "disconnected"}
                {health.data.db.error ? ` (${health.data.db.error})` : ""}
              </dd>
              <dt className="text-fg-subtle">version</dt>
              <dd>{health.data.version}</dd>
            </dl>
          )}
        </div>
      </section>
    </main>
  );
}
