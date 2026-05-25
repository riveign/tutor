import { describe, expect, it } from "vitest";

import {
  normalizeCollectorNumber,
  pickDefaultPrinting,
} from "@/lib/cardDefaults";

// `pickDefaultFinish` was removed in Phase 8i alongside the Finish UI; the
// add form now sends `"nonfoil"` as a silent default.

describe("pickDefaultPrinting", () => {
  type P = { id: string; released_at: string | null; finishes: string[] };

  it("returns the newest nonfoil printing when a mix is present", () => {
    const printings: P[] = [
      { id: "old-nonfoil", released_at: "2010-01-01", finishes: ["nonfoil"] },
      { id: "newest-foil", released_at: "2024-05-01", finishes: ["foil"] },
      { id: "mid-nonfoil", released_at: "2022-02-18", finishes: ["nonfoil", "foil"] },
    ];
    expect(pickDefaultPrinting(printings)?.id).toBe("mid-nonfoil");
  });

  it("falls back to the newest of any finish when no nonfoil exists", () => {
    const printings: P[] = [
      { id: "old-foil", released_at: "2010-01-01", finishes: ["foil"] },
      { id: "new-etched", released_at: "2024-05-01", finishes: ["etched"] },
    ];
    expect(pickDefaultPrinting(printings)?.id).toBe("new-etched");
  });

  it("returns null for an empty list", () => {
    expect(pickDefaultPrinting<P>([])).toBeNull();
  });

  it("returns the single printing regardless of finish", () => {
    const single: P[] = [
      { id: "only", released_at: "2020-01-01", finishes: ["foil"] },
    ];
    expect(pickDefaultPrinting(single)?.id).toBe("only");
  });

  it("breaks ties by membership (either tied printing is acceptable)", () => {
    const tied: P[] = [
      { id: "a", released_at: "2024-05-01", finishes: ["nonfoil"] },
      { id: "b", released_at: "2024-05-01", finishes: ["nonfoil"] },
    ];
    const picked = pickDefaultPrinting(tied);
    expect(picked).not.toBeNull();
    if (picked) {
      expect(["a", "b"]).toContain(picked.id);
    }
  });

  it("sorts NULL release dates to the bottom", () => {
    const printings: P[] = [
      { id: "no-date-nonfoil", released_at: null, finishes: ["nonfoil"] },
      { id: "dated-nonfoil", released_at: "2010-01-01", finishes: ["nonfoil"] },
    ];
    expect(pickDefaultPrinting(printings)?.id).toBe("dated-nonfoil");
  });
});

describe("normalizeCollectorNumber", () => {
  it("strips leading zeros from purely numeric input", () => {
    expect(normalizeCollectorNumber("0123")).toBe("123");
  });

  it("preserves non-digit suffix characters like a star promo marker", () => {
    expect(normalizeCollectorNumber("42★")).toBe("42★");
  });

  it("strips leading zeros while preserving suffix letters", () => {
    expect(normalizeCollectorNumber("0007a")).toBe("7a");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCollectorNumber("  42  ")).toBe("42");
  });

  it("collapses all-zero input to a single zero (not empty)", () => {
    expect(normalizeCollectorNumber("0000")).toBe("0");
  });

  it("returns the empty string for empty / whitespace-only input", () => {
    expect(normalizeCollectorNumber("")).toBe("");
    expect(normalizeCollectorNumber("   ")).toBe("");
  });
});
