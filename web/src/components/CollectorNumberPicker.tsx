/**
 * CollectorNumberPicker — the "Collector #" alternative to name search.
 *
 * Flow:
 *   1. User picks a set from the inline SetPicker (autocomplete-style,
 *      same visual layout as the name picker's result list).
 *   2. Once a set is selected, the picker collapses to a "selected set"
 *      chip + a numeric input. Auto-focus on the number input.
 *   3. User types a collector number and presses Enter to run a lookup
 *      against `/cards/search?set_code=…&collector_number=…`.
 *      * Exactly 1 result → emit highlight (carrying the collector_number
 *        filter so the preview defaults to that exact printing).
 *      * Multiple results (rare variant collision) → inline chooser
 *        listing every match; clicking a row emits highlight.
 *      * Zero results → red border + "No card with #N in {set name}".
 *        Below the error, a "Or search by name →" fallback flips the
 *        outer mode toggle.
 *   4. After a successful add the parent bumps `successFlashKey`; the
 *      picker clears the number field, refocuses it, and KEEPS the
 *      selected set so the user can rip a whole pack by typing numbers.
 *
 * The selected set is local component state (not lifted) — the parent
 * doesn't need to know which set is active, only which highlight to
 * preview.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import type { CardPickerHighlight } from "@/components/CardPicker";
import { SetPicker } from "@/components/SetPicker";
import { api, type CardSummary, type SetSummary } from "@/lib/api/client";
import { normalizeCollectorNumber } from "@/lib/cardDefaults";

const LOOKUP_LIMIT = 10;

export type CollectorNumberPickerHandle = {
  /**
   * Called by the parent after a successful add. Clears the number input
   * (keeping the set) and refocuses the input so repeat-adds are
   * keystroke-only.
   */
  resetForNextAdd: () => void;
};

export type CollectorNumberPickerProps = {
  onHighlight: (highlight: CardPickerHighlight | null) => void;
  /** Mode-toggle escape hatch when a number lookup misses. */
  onSwitchToName: () => void;
  /** Bumped by the parent on every successful add. */
  successFlashKey?: number;
};

export const CollectorNumberPicker = forwardRef<
  CollectorNumberPickerHandle,
  CollectorNumberPickerProps
>(function CollectorNumberPicker(
  { onHighlight, onSwitchToName, successFlashKey },
  ref,
) {
  const [selectedSet, setSelectedSet] = useState<SetSummary | null>(null);
  const [rawNumber, setRawNumber] = useState("");
  /** Latest submitted (Enter) value — drives the lookup query. */
  const [submittedNumber, setSubmittedNumber] = useState<string | null>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);

  // Clear highlight whenever the set changes — there's nothing to preview
  // until the user has typed and submitted a number.
  useEffect(() => {
    setSubmittedNumber(null);
    setRawNumber("");
    onHighlight(null);
  }, [selectedSet?.code, onHighlight]);

  // Auto-focus the number input when the set is selected. Keying on `.code`
  // (the only thing the effect reads from `selectedSet`) keeps the focus
  // call from re-firing if the parent ever swapped a structurally-identical
  // object reference.
  const selectedSetCode = selectedSet?.code;
  useEffect(() => {
    if (selectedSetCode) numberInputRef.current?.focus();
  }, [selectedSetCode]);

  useImperativeHandle(
    ref,
    () => ({
      resetForNextAdd: () => {
        setRawNumber("");
        setSubmittedNumber(null);
        numberInputRef.current?.focus();
      },
    }),
    [],
  );

  // Forward successFlashKey -> reset (the parent already triggers focus
  // via the imperative handle; this is a no-op if the parent already
  // called `resetForNextAdd`, but it guards against any caller that bumps
  // `successFlashKey` without invoking the handle).
  const lastFlashRef = useRef(successFlashKey);
  useEffect(() => {
    if (successFlashKey === undefined) return;
    if (successFlashKey === lastFlashRef.current) return;
    lastFlashRef.current = successFlashKey;
    setRawNumber("");
    setSubmittedNumber(null);
  }, [successFlashKey]);

  // --------------- lookup query ---------------
  const normalized = useMemo(
    () => (submittedNumber ? normalizeCollectorNumber(submittedNumber) : ""),
    [submittedNumber],
  );

  const enabled = !!selectedSet && normalized.length > 0;
  const lookupQuery = useQuery({
    queryKey: ["cards", "lookup", selectedSet?.code ?? "", normalized],
    queryFn: () =>
      api.cards.search({
        set_code: selectedSet?.code,
        collector_number: normalized,
        page: 1,
        page_size: LOOKUP_LIMIT,
      }),
    enabled,
    staleTime: 60_000,
  });

  // Memoise so the effect's identity check doesn't fire on every render.
  const results = useMemo(
    () => lookupQuery.data?.items ?? [],
    [lookupQuery.data?.items],
  );

  // --------------- highlight emission ---------------
  //
  // Exactly-one hit → emit highlight immediately. Multiple hits → show
  // the chooser; emit only after the user picks. Zero hits → emit null
  // and the parent renders the placeholder.
  const onHighlightRef = useRef(onHighlight);
  useEffect(() => {
    onHighlightRef.current = onHighlight;
  }, [onHighlight]);

  useEffect(() => {
    if (!enabled || !selectedSet) return;
    if (!lookupQuery.isSuccess) {
      onHighlightRef.current(null);
      return;
    }
    if (results.length === 1) {
      const only = results[0];
      if (only) {
        emit(only, selectedSet, normalized);
      }
    } else if (results.length === 0) {
      onHighlightRef.current(null);
    }
    // Multiple results: do NOT auto-pick; wait for the user.
  }, [
    enabled,
    selectedSet,
    lookupQuery.isSuccess,
    results,
    normalized,
    emit,
  ]);

  const emit = useCallback(
    (card: CardSummary, set: SetSummary, cn: string) => {
      onHighlightRef.current({
        oracle_id: card.oracle_id,
        name: card.name,
        mana_cost: card.mana_cost ?? null,
        type_line: card.type_line,
        set_code_filter: set.code,
        collector_number_filter: cn,
      });
    },
    [],
  );

  const submit = () => {
    const trimmed = rawNumber.trim();
    if (!trimmed) return;
    setSubmittedNumber(trimmed);
  };

  const handleNumberKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  // --------------- render ---------------
  if (!selectedSet) {
    return (
      <SetPicker
        onPick={setSelectedSet}
        autoFocus
      />
    );
  }

  const hasError =
    enabled &&
    lookupQuery.isSuccess &&
    results.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SelectedSetChip set={selectedSet} onClear={() => setSelectedSet(null)} />

      <label className="grid gap-1">
        <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Collector number
        </span>
        <input
          ref={numberInputRef}
          type="text"
          inputMode="numeric"
          value={rawNumber}
          onChange={(e) => setRawNumber(e.currentTarget.value)}
          onKeyDown={handleNumberKeyDown}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={hasError ? "collector-number-error" : undefined}
          placeholder="e.g. 161"
          className={[
            "rounded border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent",
            hasError ? "border-signal-danger" : "border-border",
          ].join(" ")}
        />
        <span className="font-mono text-xs text-fg-subtle">
          Enter to look up · Enter again on Confirm to add
        </span>
      </label>

      {/* Lookup feedback */}
      <div
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      >
        {enabled && lookupQuery.isPending && (
          <p className="font-mono text-xs text-fg-subtle">Looking up…</p>
        )}
        {enabled && lookupQuery.isError && (
          <p role="alert" className="font-mono text-xs text-signal-danger">
            Lookup failed: {lookupQuery.error.message}
          </p>
        )}
        {hasError && (
          <div id="collector-number-error" className="flex flex-col gap-2">
            <p className="font-mono text-xs text-signal-danger">
              No card with #{rawNumber} in {selectedSet.name} (
              {selectedSet.code.toUpperCase()}).
            </p>
            <button
              type="button"
              onClick={onSwitchToName}
              className="self-start font-mono text-xs uppercase tracking-widest text-fg underline hover:no-underline"
            >
              Or search by name →
            </button>
          </div>
        )}
        {enabled && results.length > 1 && (
          <VariantChooser
            matches={results}
            set={selectedSet}
            cn={normalized}
            onPick={(card) => emit(card, selectedSet, normalized)}
          />
        )}
        {enabled && results.length === 1 && (
          <p className="font-mono text-xs text-fg-subtle">
            Tab to Confirm.
          </p>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Selected-set chip
// ---------------------------------------------------------------------------

function SelectedSetChip({
  set,
  onClear,
}: {
  set: SetSummary;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2">
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-fg">
          {set.code}
        </span>
        <span className="text-sm text-fg-muted">{set.name}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Change set"
        className="font-mono text-xs uppercase tracking-widest text-fg-subtle hover:text-fg"
      >
        × Change
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant chooser — for the rare case where set+collector resolves to >1
// oracle (e.g. some special variants share collector numbers).
// ---------------------------------------------------------------------------

function VariantChooser({
  matches,
  set,
  cn,
  onPick,
}: {
  matches: CardSummary[];
  set: SetSummary;
  cn: string;
  onPick: (card: CardSummary) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
        Multiple matches for #{cn} in {set.code.toUpperCase()}
      </p>
      <ul className="rounded border border-border bg-surface-raised">
        {matches.map((card) => (
          <li key={card.oracle_id}>
            <button
              type="button"
              onClick={() => onPick(card)}
              className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-sunken"
            >
              <span className="flex flex-1 items-baseline gap-2">
                <span className="font-medium text-fg">{card.name}</span>
                <span className="font-mono text-xs text-fg-subtle">
                  {card.mana_cost ?? ""}
                </span>
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
