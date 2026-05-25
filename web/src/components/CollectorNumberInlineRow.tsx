/**
 * CollectorNumberInlineRow — a single horizontal "rip the pack" add row
 * (Phase 8g, refined in 8i). Replaces the previous Collector # split-pane.
 *
 * Layout target:
 *
 *   [Set chip] [# stacked] [thumb + name + mana] [Qty stacked] [More] [Confirm]
 *
 * Rationale: when ripping a sealed pool the user types set+#+Enter, eyeballs
 * the small thumb to confirm it's the right card, sets Qty for the playset
 * count, and hits Enter again on Confirm. Everything stays in one row so
 * nothing scrolls off-screen. Finish and Condition are deferred until we
 * actually ship collector-grade tracking — for the gameplay/deckbuilding
 * audience they were noise.
 *
 * Behaviour:
 *   * Set is sticky across adds (set the bag, type many numbers).
 *   * After a successful add the number field clears and refocuses.
 *   * "More" toggle expands a single secondary row with language / acquired_at
 *     / acquired_from / notes — never pushes Confirm out of view.
 *   * Not-found: red border + inline error + "Or search by name →" escape
 *     that flips the outer mode toggle.
 *   * Variant collision: dropdown listing every match, rendered above the
 *     row so the primary form line stays the rhythm anchor.
 *
 * This component owns its own form state + lookup; it emits
 * `onConfirm(CardPreviewConfirmPayload)` with `finish: "nonfoil"` +
 * `condition: "near_mint"` defaults so the parent's existing mutation handler
 * is unchanged.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { SetPicker } from "@/components/SetPicker";
import type { CardPreviewConfirmPayload } from "@/components/CardPreview";
import {
  api,
  type CardDetail,
  type CardSummary,
  type SetSummary,
} from "@/lib/api/client";
import { normalizeCollectorNumber, pickDefaultPrinting } from "@/lib/cardDefaults";

const LOOKUP_LIMIT = 10;

// ---------------------------------------------------------------------------
// Types & narrowing helpers (same shape as CardPreview — duplicated rather
// than exported to keep CardPreview's surface stable).
// ---------------------------------------------------------------------------

type Printing = CardDetail["printings"][number];

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
  return imageUris.small ?? imageUris.normal ?? imageUris.large ?? null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CollectorNumberInlineRowProps = {
  /** Fired with a complete payload when the user hits Confirm. */
  onConfirm: (payload: CardPreviewConfirmPayload) => void;
  /** Bumped by the parent after every successful add. */
  successFlashKey?: number;
  /** True while the parent mutation is in flight; disables Confirm. */
  isSubmitting?: boolean;
  /** Outer mode-toggle escape hatch when a number lookup misses. */
  onSwitchToName: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollectorNumberInlineRow({
  onConfirm,
  successFlashKey,
  isSubmitting,
  onSwitchToName,
}: CollectorNumberInlineRowProps) {
  // -------------------- set + number input state --------------------
  const [selectedSet, setSelectedSet] = useState<SetSummary | null>(null);
  const [rawNumber, setRawNumber] = useState("");
  /** Latest submitted (Enter) value — drives the lookup query. */
  const [submittedNumber, setSubmittedNumber] = useState<string | null>(null);
  /** Manual variant pick when collector # matches multiple oracles. */
  const [variantPick, setVariantPick] = useState<CardSummary | null>(null);

  const numberInputRef = useRef<HTMLInputElement>(null);

  // Clear lookup state whenever the set changes.
  useEffect(() => {
    setSubmittedNumber(null);
    setRawNumber("");
    setVariantPick(null);
  }, [selectedSet?.code]);

  // Auto-focus the number input when the set has just been picked.
  const selectedSetCode = selectedSet?.code;
  useEffect(() => {
    if (selectedSetCode) numberInputRef.current?.focus();
  }, [selectedSetCode]);

  // -------------------- lookup --------------------
  const normalized = useMemo(
    () => (submittedNumber ? normalizeCollectorNumber(submittedNumber) : ""),
    [submittedNumber],
  );

  const lookupEnabled = !!selectedSet && normalized.length > 0;
  const lookupQuery = useQuery({
    queryKey: ["cards", "lookup", selectedSet?.code ?? "", normalized],
    queryFn: () =>
      api.cards.search({
        set_code: selectedSet?.code,
        collector_number: normalized,
        page: 1,
        page_size: LOOKUP_LIMIT,
      }),
    enabled: lookupEnabled,
    staleTime: 60_000,
  });

  const lookupResults = useMemo<CardSummary[]>(
    () => lookupQuery.data?.items ?? [],
    [lookupQuery.data?.items],
  );

  /**
   * Active oracle hit:
   *   * 0 results → null (no card)
   *   * 1 result  → that result
   *   * >1 results → whichever the user has chosen via the variant dropdown
   *     (defaults to null until they pick)
   */
  const activeOracle = useMemo<CardSummary | null>(() => {
    if (!lookupQuery.isSuccess) return null;
    if (lookupResults.length === 0) return null;
    if (lookupResults.length === 1) return lookupResults[0] ?? null;
    return variantPick;
  }, [lookupQuery.isSuccess, lookupResults, variantPick]);

  // Clear the variant pick whenever the result set changes (a new lookup).
  useEffect(() => {
    setVariantPick(null);
  }, [lookupResults]);

  // -------------------- detail fetch (resolves printings + image) --------------------
  const detailQuery = useQuery({
    queryKey: ["cards", "detail", "picker", activeOracle?.oracle_id ?? ""],
    queryFn: () => {
      if (!activeOracle)
        throw new Error("detailQuery enabled without activeOracle");
      return api.cards.get(activeOracle.oracle_id);
    },
    enabled: activeOracle !== null,
    staleTime: 60_000,
  });

  // Narrow printings to the selected set, then lock onto the exact collector
  // number the user typed (defensive fallback: the latest-nonfoil heuristic).
  const activePrinting = useMemo<Printing | null>(() => {
    if (!detailQuery.data || !selectedSet) return null;
    const setTarget = selectedSet.code.toLowerCase();
    const setPrintings = detailQuery.data.printings.filter(
      (p) => p.set_code.toLowerCase() === setTarget,
    );
    if (setPrintings.length === 0) return null;

    const cnTarget = normalized.toLowerCase();
    if (cnTarget) {
      const exact = setPrintings.find(
        (p) => p.collector_number.toLowerCase() === cnTarget,
      );
      if (exact) return exact;
    }

    const candidates = setPrintings.map((p) => ({
      ...p,
      released_at: p.released_at ?? null,
    }));
    const picked = pickDefaultPrinting(candidates);
    if (!picked) return null;
    return setPrintings.find((p) => p.id === picked.id) ?? null;
  }, [detailQuery.data, selectedSet, normalized]);

  // -------------------- form state --------------------
  // Finish and Condition are intentionally NOT user-editable in Phase 8i —
  // the product is gameplay/deckbuilding-focused, not collector-grade. We
  // still send the API-required defaults so the schema (which uniquely keys
  // on (collection_id, printing_id, finish, language, condition)) is happy
  // and so a future re-introduction of the controls is a pure UI change.
  const [quantity, setQuantity] = useState(1);
  const [language, setLanguage] = useState("en");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------- reset on successful add --------------------
  const resetForNextAdd = useCallback(() => {
    setRawNumber("");
    setSubmittedNumber(null);
    setVariantPick(null);
    setQuantity(1);
    setLanguage("en");
    setAcquiredAt("");
    setAcquiredFrom("");
    setNotes("");
    setMoreOpen(false);
    setError(null);
    // Keep the set; clear the number and refocus.
    numberInputRef.current?.focus();
  }, []);

  const lastFlashRef = useRef<number | undefined>(successFlashKey);
  useEffect(() => {
    if (successFlashKey === undefined) return;
    if (successFlashKey === lastFlashRef.current) return;
    lastFlashRef.current = successFlashKey;
    resetForNextAdd();
  }, [successFlashKey, resetForNextAdd]);

  // -------------------- handlers --------------------
  const submitLookup = () => {
    const trimmed = rawNumber.trim();
    if (!trimmed) return;
    setSubmittedNumber(trimmed);
    setVariantPick(null);
  };

  const handleNumberKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitLookup();
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeOracle || !activePrinting) {
      setError("Look up a card first.");
      return;
    }
    if (quantity < 1) {
      setError("Quantity must be at least 1.");
      return;
    }
    setError(null);
    onConfirm({
      printing_id: activePrinting.id,
      oracle_id: activeOracle.oracle_id,
      quantity,
      // Silent defaults — see "form state" block for the rationale.
      finish: "nonfoil",
      language: language.trim() || "en",
      condition: "near_mint",
      acquired_at: acquiredAt || null,
      acquired_from: acquiredFrom.trim() || null,
      notes: notes.trim() || null,
    });
  };

  // -------------------- render: set picker (sealed-pool start) --------------------
  if (!selectedSet) {
    return (
      // Bound the height so the inline picker matches the eventual one-row
      // footprint instead of stretching the whole section. The SetPicker
      // itself fills the column and scrolls inside its `min-h-0 flex-1`
      // result list.
      <div className="flex h-[420px] flex-col rounded-md border border-border bg-surface p-4 shadow-sm">
        <SetPicker onPick={setSelectedSet} autoFocus />
      </div>
    );
  }

  // -------------------- render: main inline row --------------------
  const notFound =
    lookupEnabled && lookupQuery.isSuccess && lookupResults.length === 0;
  const multipleMatches = lookupResults.length > 1 && !variantPick;
  const confirmDisabled =
    isSubmitting ||
    !activeOracle ||
    !activePrinting ||
    detailQuery.isPending ||
    detailQuery.isError;
  const imageUrl = pickImageUrl(activePrinting?.image_uris);

  return (
    <form
      onSubmit={handleSubmit}
      aria-live="polite"
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-sm"
    >
      {/* Variant chooser surfaces above the main row when collector # matches
          multiple oracles — rare but real for split / DFC printings. */}
      {multipleMatches && (
        <VariantChooserInline
          matches={lookupResults}
          setCode={selectedSet.code}
          collectorNumber={normalized}
          onPick={setVariantPick}
        />
      )}

      {/* Main horizontal row.
          *
          *   Alignment contract:
          *     - All cells use `items-end` so the input baselines (the bottom
          *       edge of each visible input box) sit on the same line.
          *     - Every input is `h-9` so the row has a single consistent
          *       control height — the thumb + name block self-centers inside
          *       its larger fixed slot.
          *     - The thumb slot is fixed-aspect 5:7 and never participates in
          *       label rhythm — its column simply expands to fill remaining
          *       width.
          *     - At ≥lg (1024px) the row stays on a single line; below that
          *       cells wrap and re-balance via the consistent `gap-4`.
          */}
      <div className="flex flex-wrap items-end gap-4 lg:flex-nowrap">
        {/* Set chip — stacked so its visual rhythm matches the # / Qty
            inputs (label above, control below). */}
        <SetChip
          set={selectedSet}
          onChange={() => setSelectedSet(null)}
        />

        {/* Collector # input — stacked label matches Qty for column rhythm. */}
        <label className="flex shrink-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
            #
          </span>
          <input
            ref={numberInputRef}
            type="text"
            inputMode="numeric"
            value={rawNumber}
            onChange={(e) => setRawNumber(e.currentTarget.value)}
            onKeyDown={handleNumberKeyDown}
            aria-invalid={notFound ? true : undefined}
            aria-label="Collector number"
            aria-describedby={notFound ? "cn-inline-error" : undefined}
            placeholder="161"
            className={[
              "h-9 w-20 rounded border bg-surface px-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent",
              notFound ? "border-signal-danger" : "border-border",
            ].join(" ")}
          />
        </label>

        {/* Thumb + identity — visible only once a printing resolves. */}
        <CardIdentityCell
          card={activeOracle}
          printing={activePrinting}
          imageUrl={imageUrl}
          // Use `isFetching` rather than `isPending` because TanStack
          // reports `isPending: true` for a disabled query (which our
          // detailQuery becomes when there's no active oracle), causing a
          // false "Looking up…" on not-found rows.
          isPending={Boolean(
            lookupEnabled &&
              (lookupQuery.isFetching || detailQuery.isFetching),
          )}
          notFound={notFound}
        />

        {/* Qty — the one remaining gameplay-relevant numeric. Stacked label
            keeps the column rhythm consistent with # input. */}
        <label className="flex shrink-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
            Qty
          </span>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            disabled={!activePrinting}
            aria-label="Quantity"
            className="h-9 w-16 rounded border border-border bg-surface px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
        </label>

        {/* More toggle — pinned to the right cluster; participates in the
            same `items-end` baseline so it sits at the input bottom. */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="ml-auto flex h-9 shrink-0 items-center font-mono text-[10px] uppercase tracking-widest text-fg-subtle transition hover:text-fg"
        >
          {moreOpen ? "\u25be Less" : "\u25be More"}
        </button>

        {/* Confirm — equal height (h-9) so it baselines with every input. */}
        <button
          type="submit"
          disabled={confirmDisabled}
          className="flex h-9 shrink-0 items-center rounded bg-accent px-4 font-mono text-xs uppercase tracking-widest text-accent-fg shadow-sm transition hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Adding\u2026" : "Confirm \u23ce"}
        </button>
      </div>

      {/* Secondary "More" disclosure — lives BELOW the main row so it never
          pushes Confirm off-screen. */}
      {moreOpen && (
        <MoreFields
          language={language}
          onLanguageChange={setLanguage}
          acquiredAt={acquiredAt}
          onAcquiredAtChange={setAcquiredAt}
          acquiredFrom={acquiredFrom}
          onAcquiredFromChange={setAcquiredFrom}
          notes={notes}
          onNotesChange={setNotes}
        />
      )}

      {/* Status line — errors / lookup failures / not-found escape hatch. */}
      <div aria-live="polite" className="flex min-h-[1.25rem] flex-col gap-1">
        {lookupEnabled && lookupQuery.isError && (
          <p role="alert" className="font-mono text-xs text-signal-danger">
            Lookup failed: {lookupQuery.error.message}
          </p>
        )}
        {notFound && (
          <p
            id="cn-inline-error"
            className="flex flex-wrap items-center gap-2 font-mono text-xs text-signal-danger"
          >
            <span>
              No card with #{rawNumber} in {selectedSet.name} (
              {selectedSet.code.toUpperCase()}).
            </span>
            <button
              type="button"
              onClick={onSwitchToName}
              className="font-mono text-xs uppercase tracking-widest text-fg underline hover:no-underline"
            >
              Or search by name {"\u2192"}
            </button>
          </p>
        )}
        {detailQuery.isError && (
          <p role="alert" className="font-mono text-xs text-signal-danger">
            Failed to load card detail: {detailQuery.error.message}
          </p>
        )}
        {error && (
          <p role="alert" className="font-mono text-xs text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * "Set" cell — stacked (label above, chip below) so it shares the same
 * vertical rhythm as the # and Qty input cells. The chip's visible body is
 * `h-9` so it baselines with every other control in the row.
 */
function SetChip({
  set,
  onChange,
}: {
  set: SetSummary;
  onChange: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
        Set
      </span>
      <div className="flex h-9 items-center gap-2 rounded border border-border bg-surface-sunken px-2.5">
        <span className="font-mono text-xs uppercase tracking-widest text-fg">
          {set.code}
        </span>
        <button
          type="button"
          onClick={onChange}
          aria-label={`Change set (currently ${set.name})`}
          className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle hover:text-fg"
        >
          change
        </button>
      </div>
    </div>
  );
}

/**
 * Thumbnail + name + mana cost. Shows an empty slot while the user hasn't
 * yet submitted a number, a loading skeleton during lookup, the not-found
 * stamp on empty results, and a branded placeholder for printings without
 * an image.
 */
function CardIdentityCell({
  card,
  printing,
  imageUrl,
  isPending,
  notFound,
}: {
  card: CardSummary | null;
  printing: Printing | null;
  imageUrl: string | null;
  isPending: boolean;
  notFound: boolean;
}) {
  // The slot is always rendered so the row geometry is stable across all
  // states (no layout shift when the lookup resolves).
  const THUMB_W = "w-[88px]";
  const slotBaseClass = `${THUMB_W} aspect-[5/7] shrink-0`;

  let thumb: JSX.Element;
  let identity: JSX.Element;

  if (isPending) {
    thumb = (
      <div
        role="img"
        aria-label="Looking up card"
        className={`${slotBaseClass} flex items-center justify-center rounded border border-border bg-surface-sunken`}
      >
        <span className="font-mono text-[9px] uppercase tracking-widest text-fg-subtle">
          {"\u2026"}
        </span>
      </div>
    );
    identity = (
      <span className="font-mono text-xs text-fg-subtle">
        {"Looking up\u2026"}
      </span>
    );
  } else if (notFound) {
    thumb = (
      <div
        role="img"
        aria-label="No matching card"
        className={`${slotBaseClass} flex items-center justify-center rounded border border-dashed border-border-strong bg-surface-sunken`}
      >
        <span className="font-mono text-[9px] uppercase tracking-widest text-fg-subtle">
          {"\u2014"}
        </span>
      </div>
    );
    identity = (
      <span className="font-mono text-xs text-fg-subtle">No match</span>
    );
  } else if (!card) {
    // Idle — set picked, no number typed yet (or row 1: blank slot).
    thumb = (
      <div
        aria-hidden="true"
        className={`${slotBaseClass} rounded border border-dashed border-border bg-surface-sunken/40`}
      />
    );
    identity = (
      <span className="font-mono text-xs text-fg-subtle">
        {"Type a # and press Enter\u2026"}
      </span>
    );
  } else if (!imageUrl) {
    thumb = (
      <CardBackPlaceholderSmall
        setCode={printing?.set_code}
        collectorNumber={printing?.collector_number}
        name={card.name}
        widthClass={THUMB_W}
      />
    );
    identity = (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-serif text-sm leading-tight text-fg">
          {card.name}
        </span>
        {card.mana_cost && (
          <span className="font-mono text-[11px] text-fg-subtle">
            {card.mana_cost}
          </span>
        )}
      </div>
    );
  } else {
    thumb = (
      <img
        src={imageUrl}
        alt={`${card.name} card art`}
        loading="lazy"
        className={`${slotBaseClass} rounded border border-border bg-surface object-contain shadow-sm`}
      />
    );
    identity = (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-serif text-sm leading-tight text-fg">
          {card.name}
        </span>
        {card.mana_cost && (
          <span className="font-mono text-[11px] text-fg-subtle">
            {card.mana_cost}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-[14rem] flex-1 items-center gap-3">
      {thumb}
      <div className="flex min-w-0 flex-1 flex-col">{identity}</div>
    </div>
  );
}

/**
 * Compact branded placeholder for cards without front-face images. Mirrors
 * the bigger `CardBackPlaceholder` in `CardPreview` at thumbnail scale.
 */
function CardBackPlaceholderSmall({
  setCode,
  collectorNumber,
  name,
  widthClass,
}: {
  setCode?: string;
  collectorNumber?: string;
  name: string;
  widthClass: string;
}) {
  return (
    <div
      role="img"
      aria-label={`No image available for ${name}`}
      className={`${widthClass} flex aspect-[5/7] shrink-0 flex-col items-center justify-between rounded border-2 border-double border-border-strong bg-surface p-1.5 text-center shadow-sm`}
    >
      <span className="self-start font-mono text-[8px] uppercase tracking-widest text-fg-subtle">
        no art
      </span>
      <span className="font-serif text-[9px] uppercase tracking-[0.2em] text-fg-muted">
        Tutor
      </span>
      <span className="font-mono text-[8px] uppercase tracking-widest text-fg-subtle">
        {setCode && collectorNumber
          ? `${setCode.toUpperCase()} \u00b7 #${collectorNumber}`
          : "\u2014"}
      </span>
    </div>
  );
}

function MoreFields({
  language,
  onLanguageChange,
  acquiredAt,
  onAcquiredAtChange,
  acquiredFrom,
  onAcquiredFromChange,
  notes,
  onNotesChange,
}: {
  language: string;
  onLanguageChange: (v: string) => void;
  acquiredAt: string;
  onAcquiredAtChange: (v: string) => void;
  acquiredFrom: string;
  onAcquiredFromChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
          Lang
        </span>
        <input
          type="text"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          maxLength={8}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
          Acquired
        </span>
        <input
          type="date"
          value={acquiredAt}
          onChange={(e) => onAcquiredAtChange(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
          From
        </span>
        <input
          type="text"
          value={acquiredFrom}
          onChange={(e) => onAcquiredFromChange(e.target.value)}
          placeholder={"LGS, trade\u2026"}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
          Notes
        </span>
        <input
          type="text"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>
    </div>
  );
}

function VariantChooserInline({
  matches,
  setCode,
  collectorNumber,
  onPick,
}: {
  matches: CardSummary[];
  setCode: string;
  collectorNumber: string;
  onPick: (card: CardSummary) => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-surface-sunken px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-fg-subtle">
        Multiple matches for #{collectorNumber} in {setCode.toUpperCase()}
      </p>
      <ul className="flex flex-col">
        {matches.map((card) => (
          <li key={card.oracle_id}>
            <button
              type="button"
              onClick={() => onPick(card)}
              className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-surface"
            >
              <span className="flex flex-1 items-baseline gap-2">
                <span className="font-medium text-fg">{card.name}</span>
                {card.mana_cost && (
                  <span className="font-mono text-xs text-fg-subtle">
                    {card.mana_cost}
                  </span>
                )}
              </span>
              <span className="hidden font-mono text-xs text-fg-subtle md:inline">
                {card.type_line}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
