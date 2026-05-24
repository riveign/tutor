/**
 * Client-side tokenizer for the card-name search box.
 *
 * Supports a minimal subset of the Scryfall-style filter syntax: inline
 * `set:XXX` tokens are extracted from the free-text query and surfaced as
 * a separate `set_code` parameter, while the remaining words form `q`.
 *
 * Examples:
 *   "Lightning Bolt set:m11"       -> { q: "Lightning Bolt", setCode: "m11" }
 *   "set:dom Llanowar"             -> { q: "Llanowar",       setCode: "dom" }
 *   "set:LEA Black Lotus set:lea"  -> { q: "Black Lotus",    setCode: "lea" }
 *   "Llanowar Elves"               -> { q: "Llanowar Elves", setCode: undefined }
 *
 * Notes:
 *   - `set:` is case-insensitive; the resolved code is lowercased to match
 *     the canonical form used in the `sets` table and the search endpoint.
 *   - Multiple `set:` tokens: the LAST one wins (intuitive when the user
 *     types-then-corrects).
 *   - We deliberately do NOT parse other operators here. Adding more is a
 *     follow-up — this PR is scoped to set filtering inside the picker.
 */

export type SearchTokens = {
  q: string;
  setCode: string | undefined;
};

const TOKEN_RE = /(^|\s)set:([A-Za-z0-9]+)/gi;

export function tokenizeSearchInput(raw: string): SearchTokens {
  const input = raw ?? "";
  let setCode: string | undefined;

  // Collect all set:XXX matches; remember the last one.
  const matches = Array.from(input.matchAll(TOKEN_RE));
  for (const m of matches) {
    const code = m[2];
    if (code) setCode = code.toLowerCase();
  }

  // Strip every set:XXX (including the leading whitespace it captured) and
  // collapse remaining whitespace so "  foo  bar  " -> "foo bar".
  const stripped = input.replace(TOKEN_RE, " ").replace(/\s+/g, " ").trim();

  return { q: stripped, setCode };
}
