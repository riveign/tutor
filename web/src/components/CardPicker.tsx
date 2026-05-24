/**
 * CardPicker — type-ahead search → printing selector.
 *
 * Two-stage UX:
 *   1. The user types into the input. We debounce ~200ms, then call
 *      `/cards/search` (filtered by `q` and optionally `set_code` extracted
 *      from inline `set:XXX` tokens). Results render as a keyboard-navigable
 *      dropdown.
 *   2. When the user picks an oracle, we fetch its full detail to enumerate
 *      printings. If there's exactly one printing (or `set:XXX` narrowed it
 *      down to one), we resolve immediately. Otherwise we show an inline
 *      printing chooser keyed by set + collector #.
 *
 * Notes on scope:
 *   - This component owns NO submit logic. It calls `onSelect` with a fully
 *     resolved printing and steps back. The parent decides what to do with
 *     it (e.g. an add-to-collection form).
 *   - There's no virtualization yet — Phase 5's `/cards/search` already
 *     paginates and we cap to ~20 results here.
 *   - Keyboard model: Down/Up cycles results, Enter selects, Esc closes
 *     the dropdown (or backs out of the printing stage). Tab leaves the
 *     picker entirely.
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

/** Imperative handle so the parent can refocus the input (e.g. after submit). */
export type CardPickerHandle = {
  focus: () => void;
};

type CardPickerProps = {
  onSelect: (selection: CardPickerSelection) => void;
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
  function CardPicker({ onSelect, autoFocus, placeholder }, ref) {
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

    const results = searchQuery.data?.items ?? [];

    // Clamp the active index whenever results shrink/grow.
    useEffect(() => {
      if (activeIndex >= results.length) setActiveIndex(0);
    }, [results.length, activeIndex]);

    // --------------- printings query (stage 2) ---------------
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
                  onClick={() => pickOracle(card.oracle_id, card.name)}
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
