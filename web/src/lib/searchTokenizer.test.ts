import { describe, expect, it } from "vitest";

import { tokenizeSearchInput } from "@/lib/searchTokenizer";

describe("tokenizeSearchInput", () => {
  it("returns the input unchanged when no operator is present", () => {
    expect(tokenizeSearchInput("Lightning Bolt")).toEqual({
      q: "Lightning Bolt",
      setCode: undefined,
    });
  });

  it("extracts a trailing set:XXX token", () => {
    expect(tokenizeSearchInput("Lightning Bolt set:m11")).toEqual({
      q: "Lightning Bolt",
      setCode: "m11",
    });
  });

  it("extracts a leading set:XXX token", () => {
    expect(tokenizeSearchInput("set:dom Llanowar Elves")).toEqual({
      q: "Llanowar Elves",
      setCode: "dom",
    });
  });

  it("extracts a set:XXX token in the middle", () => {
    expect(tokenizeSearchInput("Llanowar set:dom Elves")).toEqual({
      q: "Llanowar Elves",
      setCode: "dom",
    });
  });

  it("lowercases the set code regardless of casing in the input", () => {
    expect(tokenizeSearchInput("Black Lotus SET:LEA")).toEqual({
      q: "Black Lotus",
      setCode: "lea",
    });
  });

  it("keeps the LAST set:XXX when multiple are present", () => {
    expect(tokenizeSearchInput("set:LEA Black Lotus set:lea")).toEqual({
      q: "Black Lotus",
      setCode: "lea",
    });
    expect(tokenizeSearchInput("foo set:abc bar set:xyz")).toEqual({
      q: "foo bar",
      setCode: "xyz",
    });
  });

  it("collapses double spaces left behind by stripping the token", () => {
    expect(tokenizeSearchInput("Llanowar set:dom  Elves")).toEqual({
      q: "Llanowar Elves",
      setCode: "dom",
    });
  });

  it("treats a bare set: with no code as no-op", () => {
    // Regex requires at least one alphanumeric after `set:`; otherwise
    // the literal "set:" is left in the free-text query.
    expect(tokenizeSearchInput("set: Llanowar")).toEqual({
      q: "set: Llanowar",
      setCode: undefined,
    });
  });

  it("does not match an embedded set: inside another word", () => {
    // The regex anchors on (start-of-string | whitespace), so "preset:foo"
    // is not picked up as a set token.
    expect(tokenizeSearchInput("preset:foo")).toEqual({
      q: "preset:foo",
      setCode: undefined,
    });
  });

  it("handles an empty or whitespace-only input", () => {
    expect(tokenizeSearchInput("")).toEqual({ q: "", setCode: undefined });
    expect(tokenizeSearchInput("   ")).toEqual({ q: "", setCode: undefined });
  });
});
