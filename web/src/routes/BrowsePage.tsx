/**
 * Global card browse page (`/cards`).
 *
 * Thin wrapper around the reusable `CardBrowser` component. URL search
 * params drive filter state so links stay shareable — that behaviour
 * lives inside `CardBrowser` itself, keyed off the absence of
 * `collectionId`.
 *
 * The collection-scoped version of this UI is mounted by `CollectionDetail`
 * under the "Browse" tab and passes a `collectionId`.
 */

import { CardBrowser } from "@/components/CardBrowser";

export function BrowsePage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Catalog
        </p>
        <h1 className="font-serif text-3xl text-fg">Browse cards</h1>
      </header>

      <CardBrowser />
    </main>
  );
}
