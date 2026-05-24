import { describe, expect, it } from "vitest";

import {
  normalizeCollectorNumber,
  pickDefaultFinish,
  pickDefaultPrinting,
} from "@/lib/cardDefaults";
import type { CardFinish } from "@/lib/api/collections";

describe("pickDefaultFinish", () => {
  it("prefers nonfoil when available (with other options present)", () => {
    expect(pickDefaultFinish(["foil", "nonfoil", "etched"])).toBe("nonfoil");
  });

  it("falls back to foil when nonfoil is missing", () => {
    expect(pickDefaultFinish(["foil", "etched"])).toBe("foil");
  });

  it("falls back to the first available finish when neither nonfoil nor foil exist", () => {
    expect(pickDefaultFinish(["etched", "glossy"])).toBe("etched");
  });

  it("returns nonfoil as a last-resort default for an empty input", () => {
    // Real printings always have at least one finish, but the helper
    // promises a non-null return for callers, so the empty branch is
    // exercised here.
    const empty: CardFinish[] = [];
    expect(pickDefaultFinish(empty)).toBe("nonfoil");
  });
});

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
