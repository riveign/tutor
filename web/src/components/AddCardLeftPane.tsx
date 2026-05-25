/**
 * AddCardLeftPane — left half of the split-pane add-to-collection flow.
 *
 * Owns the mode toggle (Name · Collector #), the appropriate input
 * sub-pane for the active mode, and emits the currently highlighted
 * card via `onHighlight` so the parent's CardPreview can paint it.
 *
 * Imperative refocus is exposed via a `ref` handle: the parent calls
 * `focus()` after a successful add. The behaviour is mode-aware:
 *   * Name mode: refocus the name input.
 *   * Collector-# mode: clear the number input + refocus it. The set
 *     selection persists so the user can rip a whole pack by typing
 *     numbers in sequence.
 */

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  CardPicker,
  type CardPickerHandle,
  type CardPickerHighlight,
} from "@/components/CardPicker";
import {
  CollectorNumberPicker,
  type CollectorNumberPickerHandle,
} from "@/components/CollectorNumberPicker";

export type AddCardLeftPaneHandle = {
  /** Mode-aware refocus called by the parent after a successful add. */
  focusForNextAdd: () => void;
};

export type AddCardLeftPaneProps = {
  onHighlight: (highlight: CardPickerHighlight | null) => void;
  /** Bumped by the parent after every successful add. */
  successFlashKey?: number;
};

type Mode = "name" | "collector";

export const AddCardLeftPane = forwardRef<
  AddCardLeftPaneHandle,
  AddCardLeftPaneProps
>(function AddCardLeftPane({ onHighlight, successFlashKey }, ref) {
  const [mode, setMode] = useState<Mode>("name");
  const namePickerRef = useRef<CardPickerHandle>(null);
  const collectorPickerRef = useRef<CollectorNumberPickerHandle>(null);

  useImperativeHandle(
    ref,
    () => ({
      focusForNextAdd: () => {
        if (mode === "name") {
          namePickerRef.current?.focus();
        } else {
          collectorPickerRef.current?.resetForNextAdd();
        }
      },
    }),
    [mode],
  );

  /**
   * User-initiated switch to Name mode + focus the name input. Used by the
   * "no matching card → search by name" fallback in collector mode.
   */
  const switchToName = () => {
    setMode("name");
    // The picker mounts on the next render; give it a beat then focus.
    window.setTimeout(() => namePickerRef.current?.focus(), 0);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ModeToggle value={mode} onChange={setMode} />

      {/* Mode bodies own the remaining vertical space so the helper text
          stays anchored just below them with no dead area in between. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === "name" && (
          <CardPicker
            ref={namePickerRef}
            onHighlight={onHighlight}
            autoFocus
          />
        )}

        {mode === "collector" && (
          <CollectorNumberPicker
            ref={collectorPickerRef}
            onHighlight={onHighlight}
            onSwitchToName={switchToName}
            successFlashKey={successFlashKey}
          />
        )}
      </div>

      <ModeHelper mode={mode} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Mode-aware bottom helper hint.
// ---------------------------------------------------------------------------

function ModeHelper({ mode }: { mode: Mode }) {
  // Centralised so the Name vs Collector keyboard models are documented in
  // exactly one place. The text is referenced by no test fixtures — feel
  // free to tune the wording.
  const text =
    mode === "name"
      ? "Type a name · \u2191\u2193 to choose · Tab to Confirm"
      : "Type a number · \u23ce to look up · Tab to Confirm";
  return (
    <p className="border-t border-border pt-3 font-mono text-xs text-fg-subtle">
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle — segmented control matching the Oracle · Printing toggle.
// ---------------------------------------------------------------------------

function ModeToggle({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (next: Mode) => void;
}) {
  const options: Array<{ key: Mode; label: string }> = [
    { key: "name", label: "Name" },
    { key: "collector", label: "Collector #" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Add card by"
      className="inline-flex self-start rounded border border-border bg-surface"
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
