/**
 * CardPicker — type-ahead search → printing selector.
 *
 * Two operating modes, controlled by which callbacks the parent passes:
 *
 *   * Highlight mode (Phase 8c): the parent passes `onHighlight` and consumes
 *     the currently HIGHLIGHTED search row to drive an external preview pane.
 *     Enter on a result is a no-op when no `onSelect` is provided — the user
 *     Tabs out to the preview's Confirm button instead.
 *
 *   * Two-stage mode (Phase 8a, legacy): the parent passes `onSelect`. The
 *     picker runs the original UX — type → pick oracle (Enter) → printing
 *     chooser — and emits `onSelect` once a printing is fully resolved. If
 *     there's exactly one printing (or `set:XXX` narrowed it to one), we
 *     auto-resolve and skip the chooser. The current codebase no longer uses
 *     this mode (CollectionDetail switched to highlight mode), but it stays
 *     supported so future callers don't have to reinvent it.
 *
 * Both modes share the same search input and result list.
 *
 * Keyboard model:
 *   * Down/Up cycle the highlighted result and fire `onHighlight`.
 *   * Enter on a result enters the printing chooser stage IF `onSelect` is
 *     defined; otherwise it's a no-op.
 *   * Esc closes the dropdown (or backs out of the printing chooser).
 *   * Tab leaves the picker entirely (natural focus order).
 *
 * Notes:
 *   * Hover over a result also updates the highlight (debounced ~80ms so
 *     dragging the mouse across the list doesn't thrash the preview pane).
 *   * No virtualization — `/cards/search` paginates and we cap at ~20 rows.
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

import { api } from "@/lib/api/client";
import type { CardFinish } from "@/lib/api/collections";
import { tokenizeSearchInput } from "@/lib/searchTokenizer";

const SEARCH_DEBOUNCE_MS = 200;
const RESULT_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;

/** Shape passed back to the parent when a printing is fully resolved. */
export type CardPickerSelection = {
  printing_id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  available_finishes: CardFinish[];
};

/**
 * Shape emitted on every highlight change — i.e. before the user has even
 * "picked" a result. Used by Phase 8c's preview pane. `null` means no row
 * is highlighted (empty input, no results, or user cleared focus).
 *
 * Carries only the oracle-level fields visible in the search row, plus the
 * optional `set_code_filter` extracted from a `set:XXX` token so the preview
 * can narrow its printing list to the user's intent.
 */
export type CardPickerHighlight = {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  type_line: string;
  /** Set filter active in the current query, if any. */
  set_code_filter?: string;
};

/** Imperative handle so the parent can refocus the input (e.g. after submit). */
export type CardPickerHandle = {
  focus: () => void;
};

type CardPickerProps = {
  /**
   * Called when the user fully commits a printing (legacy two-stage flow).
   * Omitting this disables the printing-chooser stage; Enter on a result
   * becomes a no-op and the parent is expected to drive completion from
   * `onHighlight` instead.
   */
  onSelect?: (selection: CardPickerSelection) => void;
  /**
   * Called whenever the highlighted search row changes (arrow keys / hover /
   * results refreshing). `null` means there is no current highlight.
   * Hover updates are debounced ~80ms; keyboard updates are immediate.
   */
  onHighlight?: (highlight: CardPickerHighlight | null) => void;
  autoFocus?: boolean;
  placeholder?: string;
};

// ---------------------------------------------------------------------------
// Type guards / narrowing
// ---------------------------------------------------------------------------

const KNOWN_FINISHES: readonly CardFinish[] = [
  "nonfoil",
  "foil",
  "etched",
  "glossy",
];

function isCardFinish(value: string): value is CardFinish {
  return (KNOWN_FINISHES as readonly string[]).includes(value);
}

/**
 * The OpenAPI schema types `printing.finishes` as `string[]` (Scryfall is
 * the source of truth). Narrow to our canonical enum and drop unknowns so
 * downstream code can rely on the type.
 */
function narrowFinishes(finishes: readonly string[]): CardFinish[] {
  return finishes.filter(isCardFinish);
}

// ---------------------------------------------------------------------------
// Debounce hook (3 lines, no dependency)
// ---------------------------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ===========================================================================
// Component
// ===========================================================================

export const CardPicker = forwardRef<CardPickerHandle, CardPickerProps>(
  function CardPicker(
    { onSelect, onHighlight, autoFocus, placeholder },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
      }),
      [],
    );

    // --------------- input / debounced query ---------------
    const [raw, setRaw] = useState("");
    const debouncedRaw = useDebounced(raw, SEARCH_DEBOUNCE_MS);
    const tokens = useMemo(
      () => tokenizeSearchInput(debouncedRaw),
      [debouncedRaw],
    );

    // --------------- stage state ---------------
    // null = picking oracle (or idle); set = chose an oracle, now picking
    // among its printings.
    const [oraclePick, setOraclePick] = useState<{
      oracleId: string;
      name: string;
    } | null>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    // Hold the latest `onHighlight` in a ref so the highlight effect's
    // dependency array can stay narrow (results + activeIndex) without
    // re-firing each time the parent rerenders with a new callback identity.
    const onHighlightRef = useRef(onHighlight);
    useEffect(() => {
      onHighlightRef.current = onHighlight;
    }, [onHighlight]);

    // --------------- search query ---------------
    const enabled =
      oraclePick === null &&
      dropdownOpen &&
      tokens.q.length >= MIN_QUERY_LENGTH;

    const searchQuery = useQuery({
      queryKey: ["cards", "search", "picker", tokens.q, tokens.setCode],
      queryFn: () =>
        api.cards.search({
          q: tokens.q,
          set_code: tokens.setCode,
          page: 1,
          page_size: RESULT_LIMIT,
        }),
      enabled,
      staleTime: 30_000,
    });

    // Memoise the items array so its identity is only refreshed on a true
    // data change. The highlight effect below depends on `results`; without
    // this the empty-array fallback would create a fresh `[]` every render
    // and re-fire the effect unnecessarily.
    const results = useMemo(
      () => searchQuery.data?.items ?? [],
      [searchQuery.data?.items],
    );

    // Clamp the active index whenever results shrink/grow.
    useEffect(() => {
      if (activeIndex >= results.length) setActiveIndex(0);
    }, [results.length, activeIndex]);

    // ----- highlight emission -----
    //
    // Fires `onHighlight` whenever the effective highlight changes. We only
    // emit while the search stage is active and the dropdown shows actual
    // results — otherwise there is nothing for the preview pane to render
    // and we emit `null`.
    //
    // Hover updates `activeIndex` synchronously (so the row paints as
    // highlighted immediately) but the highlight callback is debounced so a
    // mouse drag across the list doesn't fire the parent N times.
    const HOVER_DEBOUNCE_MS = 80;
    useEffect(() => {
      const cb = onHighlightRef.current;
      if (!cb) return;
      // While the printing chooser is open we don't change the previewed card
      // (the legacy two-stage flow owns the screen at that point).
      if (oraclePick !== null) return;
      // No usable highlight while loading / errored / empty results.
      if (!searchQuery.isSuccess) {
        cb(null);
        return;
      }
      const row = results[activeIndex];
      if (!row) {
        cb(null);
        return;
      }
      const t = window.setTimeout(() => {
        cb({
          oracle_id: row.oracle_id,
          name: row.name,
          mana_cost: row.mana_cost ?? null,
          type_line: row.type_line,
          set_code_filter: tokens.setCode,
        });
      }, HOVER_DEBOUNCE_MS);
      return () => window.clearTimeout(t);
    }, [
      activeIndex,
      results,
      searchQuery.isSuccess,
      oraclePick,
      tokens.setCode,
    ]);

    // --------------- printings query (stage 2; legacy two-stage mode) ---------------
    //
    // Only meaningful when the parent passed `onSelect`. In highlight-only
    // mode (Phase 8c) the preview pane owns its own detail fetch and we
    // never enter the printing chooser stage.
    const detailQuery = useQuery({
      queryKey: ["cards", "detail", "picker", oraclePick?.oracleId ?? ""],
      queryFn: () => {
        if (!oraclePick) throw new Error("detailQuery enabled without oracle");
        return api.cards.get(oraclePick.oracleId);
      },
      enabled: oraclePick !== null,
      staleTime: 60_000,
    });

    /**
     * Filter printings by the `set:XXX` token (if any), so picking
     * `Lightning Bolt set:m11` jumps straight past the printing step.
     */
    const filteredPrintings = useMemo(() => {
      const all = detailQuery.data?.printings ?? [];
      if (!tokens.setCode) return all;
      const target = tokens.setCode.toLowerCase();
      return all.filter((p) => p.set_code.toLowerCase() === target);
    }, [detailQuery.data, tokens.setCode]);

    // --------------- selection helpers ---------------
    const finalise = useCallback(
      (args: {
        oracleId: string;
        name: string;
        printingId: string;
        setCode: string;
        collectorNumber: string;
        finishes: readonly string[];
      }) => {
        if (!onSelect) return;
        onSelect({
          printing_id: args.printingId,
          oracle_id: args.oracleId,
          name: args.name,
          set_code: args.setCode,
          collector_number: args.collectorNumber,
          available_finishes: narrowFinishes(args.finishes),
        });
        // Reset to idle.
        setRaw("");
        setOraclePick(null);
        setDropdownOpen(false);
        setActiveIndex(0);
      },
      [onSelect],
    );

    /**
     * Auto-resolve to a single printing if (a) detail just loaded and
     * (b) the filtered printings list contains exactly one entry.
     */
    useEffect(() => {
      if (!oraclePick) return;
      if (detailQuery.isPending || detailQuery.isError) return;
      if (filteredPrintings.length !== 1) return;
      const only = filteredPrintings[0];
      if (!only) return;
      finalise({
        oracleId: oraclePick.oracleId,
        name: oraclePick.name,
        printingId: only.id,
        setCode: only.set_code,
        collectorNumber: only.collector_number,
        finishes: only.finishes,
      });
    }, [
      oraclePick,
      detailQuery.isPending,
      detailQuery.isError,
      filteredPrintings,
      finalise,
    ]);

    const pickOracle = (oracleId: string, name: string) => {
      setOraclePick({ oracleId, name });
      setDropdownOpen(false);
    };

    // --------------- keyboard handler ---------------
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (oraclePick) {
        if (e.key === "Escape") {
          e.preventDefault();
          setOraclePick(null);
          setDropdownOpen(true);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!dropdownOpen) setDropdownOpen(true);
        if (results.length > 0) {
          setActiveIndex((i) => (i + 1) % results.length);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length > 0) {
          setActiveIndex((i) => (i - 1 + results.length) % results.length);
        }
        return;
      }
      if (e.key === "Enter") {
        // Highlight-only mode (no `onSelect`): Enter is a no-op. The user
        // is expected to Tab to the preview's Confirm button. Letting the
        // input absorb the Enter avoids accidentally submitting an
        // enclosing <form>.
        if (!onSelect) {
          if (dropdownOpen) e.preventDefault();
          return;
        }
        if (!dropdownOpen || results.length === 0) return;
        e.preventDefault();
        const pick = results[activeIndex];
        if (pick) pickOracle(pick.oracle_id, pick.name);
        return;
      }
      if (e.key === "Escape") {
        if (dropdownOpen) {
          e.preventDefault();
          setDropdownOpen(false);
        }
      }
    };

    // --------------- render ---------------
    const showDropdown = oraclePick === null && dropdownOpen;
    const showPrintings = oraclePick !== null;

    return (
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown || showPrintings}
          aria-controls="card-picker-listbox"
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={raw}
          onChange={(e) => {
            setRaw(e.currentTarget.value);
            setDropdownOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={(e) => {
            // Defer close so a click on a result still fires.
            const next = e.relatedTarget;
            if (next instanceof Node && e.currentTarget.parentElement?.contains(next)) {
              return;
            }
            window.setTimeout(() => setDropdownOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Search cards (try: Lightning Bolt set:m11)"}
          className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {showDropdown && tokens.q.length < MIN_QUERY_LENGTH && (
          <div className="absolute z-20 mt-1 w-full rounded border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-fg-subtle shadow">
            Type at least {MIN_QUERY_LENGTH} characters…
          </div>
        )}

        {showDropdown && tokens.q.length >= MIN_QUERY_LENGTH && (
          <ul
            id="card-picker-listbox"
            role="listbox"
            className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded border border-border bg-surface-raised shadow"
          >
            {searchQuery.isPending && (
              <li className="px-3 py-2 font-mono text-xs text-fg-subtle">
                Searching…
              </li>
            )}
            {searchQuery.isError && (
              <li
                role="alert"
                className="px-3 py-2 font-mono text-xs text-signal-danger"
              >
                Search failed: {searchQuery.error.message}
              </li>
            )}
            {searchQuery.isSuccess && results.length === 0 && (
              <li className="px-3 py-2 font-mono text-xs text-fg-subtle">
                No cards match.
              </li>
            )}
            {results.map((card, i) => (
              <li key={card.oracle_id} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent input blur from closing the list before the
                    // click handler resolves.
                    e.preventDefault();
                  }}
                  onClick={() => {
                    // In highlight-only mode click just sets the highlight
                    // (the mouse-enter already did that); the parent's
                    // preview/Confirm flow handles commit.
                    if (!onSelect) {
                      setActiveIndex(i);
                      inputRef.current?.focus();
                      return;
                    }
                    pickOracle(card.oracle_id, card.name);
                  }}
                  className={[
                    "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm",
                    i === activeIndex
                      ? "bg-surface-sunken text-fg"
                      : "text-fg hover:bg-surface-sunken",
                  ].join(" ")}
                >
                  <span className="flex flex-1 items-baseline gap-2">
                    <span className="font-medium">{card.name}</span>
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
        )}

        {showPrintings && (
          <PrintingChooser
            cardName={oraclePick.name}
            isPending={detailQuery.isPending}
            isError={detailQuery.isError}
            errorMessage={detailQuery.error?.message}
            printings={filteredPrintings}
            onCancel={() => {
              setOraclePick(null);
              setDropdownOpen(true);
              inputRef.current?.focus();
            }}
            onPick={(p) =>
              finalise({
                oracleId: oraclePick.oracleId,
                name: oraclePick.name,
                printingId: p.id,
                setCode: p.set_code,
                collectorNumber: p.collector_number,
                finishes: p.finishes,
              })
            }
          />
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Printing chooser sub-component
// ---------------------------------------------------------------------------

type PrintingChoice = {
  id: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  finishes: string[];
  rarity: string;
  released_at?: string | null;
};

function PrintingChooser({
  cardName,
  isPending,
  isError,
  errorMessage,
  printings,
  onPick,
  onCancel,
}: {
  cardName: string;
  isPending: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  printings: PrintingChoice[];
  onPick: (p: PrintingChoice) => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute z-20 mt-1 w-full rounded border border-border bg-surface-raised shadow">
      <header className="flex items-baseline justify-between border-b border-border px-3 py-2">
        <p className="text-sm text-fg">
          <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
            Pick printing:{" "}
          </span>
          <span className="font-medium">{cardName}</span>
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-xs uppercase tracking-widest text-fg-subtle hover:text-fg"
        >
          Esc · Back
        </button>
      </header>

      {isPending && (
        <p className="px-3 py-3 font-mono text-xs text-fg-subtle">
          Loading printings…
        </p>
      )}
      {isError && (
        <p
          role="alert"
          className="px-3 py-3 font-mono text-xs text-signal-danger"
        >
          Failed to load printings: {errorMessage ?? "unknown error"}
        </p>
      )}
      {!isPending && !isError && printings.length === 0 && (
        <p className="px-3 py-3 font-mono text-xs text-fg-subtle">
          No printings match the active filter.
        </p>
      )}
      {!isPending && !isError && printings.length > 0 && (
        <ul className="max-h-80 overflow-y-auto">
          {printings.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(p)}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-sunken"
              >
                <span className="flex flex-1 items-baseline gap-2">
                  <span className="font-mono text-xs uppercase tracking-widest text-fg">
                    {p.set_code}
                  </span>
                  <span className="font-mono text-xs text-fg-subtle">
                    #{p.collector_number}
                  </span>
                  <span className="text-fg-muted">{p.set_name}</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  {narrowFinishes(p.finishes).map((f) => (
                    <span
                      key={f}
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-subtle"
                    >
                      {f}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
