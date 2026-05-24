import { describe, expect, it } from "vitest";

import { pickDefaultFinish } from "@/lib/cardDefaults";
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
