/**
 * SetPicker — type-ahead set search rendered inline in the parent's
 * vertical slot (no popover). Used by `CollectorNumberPicker`.
 *
 * The empty input shows the catalog's newest 50 sets (sorted by
 * `released_at DESC`), so the user can hit ↓ immediately without typing.
 * Substring matching is server-side (`/sets?q=`).
 *
 * Keyboard model mirrors `CardPicker`:
 *   * ↓ / ↑ cycle highlight.
 *   * Enter picks the highlighted set.
 *   * Type → ↓ → Enter is a 3-keystroke commit.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { api, type SetSummary } from "@/lib/api/client";

const DEBOUNCE_MS = 200;

type SetPickerProps = {
  onPick: (set: SetSummary) => void;
  autoFocus?: boolean;
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SetPicker({ onPick, autoFocus }: SetPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState("");
  const debounced = useDebounced(raw.trim(), DEBOUNCE_MS);
  const [activeIndex, setActiveIndex] = useState(0);

  const query = useQuery({
    queryKey: ["sets", "search", debounced],
    queryFn: () =>
      api.sets.list(debounced ? { q: debounced } : {}),
    staleTime: 60_000,
  });

  const results = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0);
  }, [results.length, activeIndex]);

  const releaseYear = (set: SetSummary): string => {
    if (!set.released_at) return "—";
    // ISO YYYY-MM-DD; just grab the first 4 chars.
    return set.released_at.slice(0, 4);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((i) => (i + 1) % results.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex(
          (i) => (i - 1 + results.length) % results.length,
        );
      }
      return;
    }
    if (e.key === "Enter") {
      if (results.length === 0) return;
      e.preventDefault();
      const pick = results[activeIndex];
      if (pick) onPick(pick);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <label className="grid gap-1">
        <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
          Set
        </span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="set-picker-listbox"
          aria-autocomplete="list"
          autoFocus={autoFocus}
          value={raw}
          onChange={(e) => {
            setRaw(e.currentTarget.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search sets by name or code"
          className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface-raised">
        {query.isPending && (
          <p className="px-3 py-3 font-mono text-xs text-fg-subtle">
            Loading sets…
          </p>
        )}
        {query.isError && (
          <p
            role="alert"
            className="px-3 py-3 font-mono text-xs text-signal-danger"
          >
            Failed to load sets: {query.error.message}
          </p>
        )}
        {query.isSuccess && results.length === 0 && (
          <p className="px-3 py-3 font-mono text-xs text-fg-subtle">
            No sets match{" "}
            <span className="font-medium text-fg">
              &ldquo;{debounced}&rdquo;
            </span>
            .
          </p>
        )}
        {results.length > 0 && (
          <ul
            id="set-picker-listbox"
            role="listbox"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {results.map((set, i) => {
              const active = i === activeIndex;
              return (
                <li key={set.code} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(set)}
                    className={[
                      "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm",
                      active
                        ? "bg-surface-sunken text-fg ring-1 ring-accent"
                        : "text-fg hover:bg-surface-sunken",
                    ].join(" ")}
                  >
                    <span className="flex flex-1 items-baseline gap-2">
                      <span className="font-medium">{set.name}</span>
                      <span className="font-mono text-xs uppercase tracking-widest text-fg-subtle">
                        {set.code}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-fg-subtle">
                      {releaseYear(set)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
