/**
 * CardPreview — right-pane companion to `CardPicker` for the Phase 8c
 * split-pane add-to-collection flow.
 *
 * Responsibilities:
 *   * Given a `selection` (the picker's currently highlighted oracle), fetch
 *     `/cards/{oracle_id}` and surface a "default printing" — the most
 *     recently released printing, narrowed by an optional `set:XXX` filter
 *     extracted from the picker's input.
 *   * Show the printing's image (lazy-loaded as soon as the card is
 *     highlighted, so the user sees the art before they hit Confirm), name,
 *     mana cost, type line, oracle text, set + collector #.
 *   * Own the per-entry form fields (qty / finish / condition, plus a
 *     "More details" disclosure for language / acquired_at / acquired_from /
 *     notes) and emit `onConfirm` with a complete payload.
 *   * After a successful add the parent bumps `successFlashKey`; we briefly
 *     show a "Added" indicator and reset the form to defaults BUT keep the
 *     selection populated so repeat-adds of the same card are one click.
 *   * When `selection` is null, render an aria-live placeholder.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";

import type { CardPickerHighlight } from "@/components/CardPicker";
import { api, type CardDetail } from "@/lib/api/client";
import {
  CONDITIONS,
  FINISHES,
  type CardCondition,
  type CardFinish,
  type CreateEntryBody,
} from "@/lib/api/collections";
import { pickDefaultFinish, pickDefaultPrinting } from "@/lib/cardDefaults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Printing = CardDetail["printings"][number];

/**
 * Shape of the image_uris JSON returned by Scryfall (subset). The API types
 * the field as `unknown` because the column is a `serde_json::Value`, so
 * we narrow defensively here.
 */
type ScryfallImageUris = {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
};

function isImageUris(value: unknown): value is ScryfallImageUris {
  return typeof value === "object" && value !== null;
}

function pickImageUrl(imageUris: unknown): string | null {
  if (!isImageUris(imageUris)) return null;
  return imageUris.normal ?? imageUris.large ?? imageUris.small ?? null;
}

const KNOWN_FINISHES: readonly CardFinish[] = FINISHES;
function isCardFinish(value: string): value is CardFinish {
  return (KNOWN_FINISHES as readonly string[]).includes(value);
}

function narrowFinishes(finishes: readonly string[]): CardFinish[] {
  return finishes.filter(isCardFinish);
}

function isCardCondition(value: string): value is CardCondition {
  return (CONDITIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Payload emitted on Confirm. Mirrors `CreateEntryBody` but is constructed
 * from local form state so the caller doesn't need to know about the API
 * type directly.
 */
export type CardPreviewConfirmPayload = {
  printing_id: string;
  oracle_id: string;
  quantity: number;
  finish: CardFinish;
  language: string;
  condition: CardCondition;
  acquired_at: string | null;
  acquired_from: string | null;
  notes: string | null;
};

export type CardPreviewProps = {
  /** Currently highlighted picker row. `null` shows the placeholder. */
  selection: CardPickerHighlight | null;
  /** Fired when the user presses Confirm with a complete, valid payload. */
  onConfirm: (payload: CardPreviewConfirmPayload) => void;
  /** Disable Confirm while a mutation is in-flight. */
  isSubmitting?: boolean;
  /**
   * Bumping this prop triggers a brief "Added" indicator AND resets the
   * form fields (but keeps the same selection — so repeat-adds of the same
   * card are one click). The parent owns the counter so it can correlate
   * with whichever mutation just succeeded.
   */
  successFlashKey?: number;
};

export function CardPreview({
  selection,
  onConfirm,
  isSubmitting,
  successFlashKey,
}: CardPreviewProps) {
  // -------------------------------------------------------------------------
  // Detail fetch — shares cache with CardPicker (same query key shape) so
  // when the user highlights and then re-highlights the same card the
  // image is already painted.
  // -------------------------------------------------------------------------
  const detailQuery = useQuery({
    queryKey: ["cards", "detail", "picker", selection?.oracle_id ?? ""],
    queryFn: () => {
      if (!selection) throw new Error("detailQuery enabled without selection");
      return api.cards.get(selection.oracle_id);
    },
    enabled: selection !== null,
    staleTime: 60_000,
  });

  // -------------------------------------------------------------------------
  // Printing selection within the preview
  // -------------------------------------------------------------------------
  //
  // The set:XXX filter (if any) narrows the printing list. Once narrowed,
  // we pick a "default" via `pickDefaultPrinting` — newest nonfoil printing
  // first; fallback to newest of any finish. The user can still override via
  // the PRINTING dropdown.
  //
  // The server already returns printings sorted by `released_at DESC NULLS
  // LAST`, which is the natural browse order for the dropdown.
  const filteredPrintings = useMemo<Printing[]>(() => {
    const all = detailQuery.data?.printings ?? [];
    if (!selection?.set_code_filter) return all;
    const target = selection.set_code_filter.toLowerCase();
    return all.filter((p) => p.set_code.toLowerCase() === target);
  }, [detailQuery.data, selection?.set_code_filter]);

  // The full (filter-aware) printing list the chooser dropdown lists. The
  // collector-# filter narrows the DEFAULT printing (so the user lands on
  // exactly the printing they typed) but does NOT hide the other printings
  // from the dropdown — they remain selectable.
  const collectorTarget = selection?.collector_number_filter?.toLowerCase();

  // Adapt the API `Printing` shape (`released_at: string | null | undefined`)
  // to the helper's `string | null` contract. The helper preserves object
  // identity in its returned reference, so we hand it the same objects and
  // can use that reference directly.
  const defaultPrinting = useMemo<Printing | null>(() => {
    if (filteredPrintings.length === 0) return null;
    // Collector-# add flow: lock the default to the exact printing the user
    // typed. Fall through to the latest-nonfoil heuristic if for some reason
    // the printing isn't in the list (defensive — the lookup that produced
    // the highlight already proved it exists).
    if (collectorTarget) {
      const exact = filteredPrintings.find(
        (p) => p.collector_number.toLowerCase() === collectorTarget,
      );
      if (exact) return exact;
    }
    const candidates = filteredPrintings.map((p) => ({
      ...p,
      released_at: p.released_at ?? null,
    }));
    const picked = pickDefaultPrinting(candidates);
    if (!picked) return null;
    return filteredPrintings.find((p) => p.id === picked.id) ?? null;
  }, [filteredPrintings, collectorTarget]);

  const [printingIdOverride, setPrintingIdOverride] = useState<string | null>(
    null,
  );

  // When the highlighted card changes (or its filtered printings refresh),
  // clear any prior override so we fall back to the default printing.
  useEffect(() => {
    setPrintingIdOverride(null);
  }, [
    selection?.oracle_id,
    selection?.set_code_filter,
    selection?.collector_number_filter,
  ]);

  const activePrinting: Printing | null = useMemo(() => {
    if (filteredPrintings.length === 0) return null;
    if (printingIdOverride) {
      const found = filteredPrintings.find((p) => p.id === printingIdOverride);
      if (found) return found;
    }
    return defaultPrinting;
  }, [filteredPrintings, printingIdOverride, defaultPrinting]);

  const availableFinishes = useMemo(
    () => narrowFinishes(activePrinting?.finishes ?? []),
    [activePrinting?.finishes],
  );

  // -------------------------------------------------------------------------
  // Form state
  // -------------------------------------------------------------------------
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [language, setLanguage] = useState("en");
  const [condition, setCondition] = useState<CardCondition>("near_mint");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whenever the active printing changes, snap the finish back to the
  // smart default for that printing's available finishes. We intentionally
  // do NOT reset quantity/condition/notes on a printing swap — only on
  // confirm or on selection change.
  useEffect(() => {
    if (availableFinishes.length === 0) return;
    setFinish(pickDefaultFinish(availableFinishes));
  }, [availableFinishes]);

  // -------------------------------------------------------------------------
  // After confirm: parent bumps successFlashKey. Reset form to defaults but
  // keep the same printing selected (the whole point of persistence) and
  // show a brief "Added" flash.
  // -------------------------------------------------------------------------
  const [flashing, setFlashing] = useState(false);
  const lastFlashRef = useRef<number | undefined>(successFlashKey);
  useEffect(() => {
    if (successFlashKey === undefined) return;
    if (successFlashKey === lastFlashRef.current) return;
    lastFlashRef.current = successFlashKey;
    // Reset form fields to defaults (re-resolving finish for the active
    // printing).
    setQuantity(1);
    setLanguage("en");
    setCondition("near_mint");
    setAcquiredAt("");
    setAcquiredFrom("");
    setNotes("");
    setMoreOpen(false);
    setError(null);
    if (availableFinishes.length > 0) {
      setFinish(pickDefaultFinish(availableFinishes));
    }
    setFlashing(true);
    const t = window.setTimeout(() => setFlashing(false), 1500);
    return () => window.clearTimeout(t);
  }, [successFlashKey, availableFinishes]);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selection || !activePrinting) {
      setError("Highlight a card first.");
      return;
    }
    if (quantity < 1) {
      setError("Quantity must be at least 1.");
      return;
    }
    setError(null);
    onConfirm({
      printing_id: activePrinting.id,
      oracle_id: selection.oracle_id,
      quantity,
      finish,
      language: language.trim() || "en",
      condition,
      acquired_at: acquiredAt || null,
      acquired_from: acquiredFrom.trim() || null,
      notes: notes.trim() || null,
    } satisfies CreateEntryBody & { oracle_id: string });
  };

  // -------------------------------------------------------------------------
  // Render: placeholder when no selection
  // -------------------------------------------------------------------------
  if (!selection) {
    return (
      <PreviewShell>
        <div
          aria-live="polite"
          className="flex h-full flex-col items-center justify-center gap-3 text-fg-subtle"
        >
          <SearchIcon />
          <p className="font-mono text-xs uppercase tracking-widest">
            Search for a card to preview
          </p>
        </div>
      </PreviewShell>
    );
  }

  // -------------------------------------------------------------------------
  // Render: card preview
  // -------------------------------------------------------------------------
  const imageUrl = pickImageUrl(activePrinting?.image_uris);
  const detail = detailQuery.data;

  return (
    <PreviewShell>
      <form
        onSubmit={handleSubmit}
        className="grid h-full gap-5 sm:grid-cols-[1fr_auto]"
        aria-live="polite"
      >
        {/* Left column: textual identity + form fields */}
        <div className="flex min-w-0 flex-col gap-4">
        {/* Identity */}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-serif text-lg text-fg">{selection.name}</h3>
            <span className="font-mono text-xs text-fg-subtle">
              {detail?.mana_cost ?? selection.mana_cost ?? ""}
            </span>
          </div>
          <p className="font-mono text-xs text-fg-subtle">
            {detail?.type_line ?? selection.type_line}
          </p>
          {detail?.oracle_text && (
            <p className="whitespace-pre-wrap text-sm text-fg-muted">
              {detail.oracle_text}
            </p>
          )}
        </div>

        {/* Printing identity + (optional) chooser */}
        <PrintingIdentity
          printings={filteredPrintings}
          active={activePrinting}
          onChange={setPrintingIdOverride}
        />

        {/* Form row: finish / quantity / condition */}
        <div className="grid gap-3 sm:grid-cols-3">
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
              disabled={!activePrinting}
              className="rounded border border-border bg-surface px-3 py-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {(availableFinishes.length > 0 ? availableFinishes : KNOWN_FINISHES).map(
                (f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ),
              )}
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

        {/* More details disclosure */}
        <details
          open={moreOpen}
          onToggle={(e) => setMoreOpen(e.currentTarget.open)}
          className="rounded border border-border bg-surface px-3 py-2"
        >
          <summary className="cursor-pointer select-none font-mono text-xs uppercase tracking-widest text-fg-subtle">
            More details
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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

        {/* Errors + success flash */}
        {error && (
          <p role="alert" className="font-mono text-xs text-signal-danger">
            {error}
          </p>
        )}
        {flashing && !error && (
          <p
            role="status"
            aria-live="polite"
            className="font-mono text-xs text-signal-success"
          >
            Added.
          </p>
        )}

        {/* Confirm */}
        <div className="mt-auto flex justify-end">
          <button
            type="submit"
            disabled={
              isSubmitting ||
              !activePrinting ||
              detailQuery.isPending ||
              detailQuery.isError
            }
            className="rounded bg-accent px-5 py-2 font-mono text-xs uppercase tracking-widest text-accent-fg shadow-sm transition disabled:opacity-50"
          >
            {isSubmitting ? "Adding…" : "Confirm"}
          </button>
        </div>

        {detailQuery.isError && (
          <p role="alert" className="font-mono text-xs text-signal-danger">
            Failed to load card detail: {detailQuery.error.message}
          </p>
        )}
        </div>

        {/* Right column: card image (capped width so the form keeps room) */}
        <div className="flex sm:justify-end">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${selection.name} card art`}
              loading="lazy"
              className="h-auto w-full max-w-[200px] rounded-lg border border-border bg-surface object-contain shadow"
            />
          ) : (
            <div className="flex h-[280px] w-[200px] items-center justify-center rounded-lg border border-border bg-surface font-mono text-xs text-fg-subtle">
              {detailQuery.isPending ? "loading…" : "no image"}
            </div>
          )}
        </div>
      </form>
    </PreviewShell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PreviewShell({ children }: { children: ReactNode }) {
  return (
    <aside
      aria-label="Card preview"
      className="flex min-h-[520px] flex-col rounded-lg border border-border bg-surface-raised p-5 shadow"
    >
      {children}
    </aside>
  );
}

function PrintingIdentity({
  printings,
  active,
  onChange,
}: {
  printings: Printing[];
  active: Printing | null;
  onChange: (id: string) => void;
}) {
  if (printings.length === 0) {
    return (
      <p className="font-mono text-xs text-fg-subtle">
        No printings available for this filter.
      </p>
    );
  }

  // Single-printing case: render as static label, no chooser needed.
  if (printings.length === 1 && active) {
    return (
      <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
        {active.set_code} · #{active.collector_number}
      </p>
    );
  }

  return (
    <label className="grid gap-1">
      <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
        Printing
      </span>
      <select
        value={active?.id ?? ""}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded border border-border bg-surface px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {printings.map((p) => (
          <option key={p.id} value={p.id}>
            {p.set_code.toUpperCase()} · #{p.collector_number} · {p.set_name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchIcon() {
  // 32px stroked magnifier — neutral, no fill, inherits currentColor.
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}
