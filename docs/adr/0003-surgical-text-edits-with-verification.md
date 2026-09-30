# ADR-0003: Surgical text edits with re-parse verification

- Status: Accepted
- Date: 2026-09-29

## Context

We must modify real-world files without reformatting them or corrupting code we don't understand.

## Decision

1. A transformation produces a small list of `TextEdit { start, end, text }` computed from exact
   AST ranges (`@vue/compiler-sfc` gives whole-file offsets for elements, attribute names/values
   and directive expressions).
2. Edits are constrained to the smallest meaningful region (for props: the element's start tag).
3. After applying the edits, the result is **re-parsed and verified**: no parse errors, bytes
   outside the start tag unchanged, same element identity and subtree size, all other attributes
   byte-identical and in order, target prop has exactly the requested value.
   Any mismatch rejects the operation and the original source is returned untouched.
4. Style is preserved: quotes (including unquoted values), binding form (`title="x"` vs
   `:title="'x'"`), layout (one-attribute-per-line vs inline), indentation and EOL (CRLF).
5. `checkRoundTrip` (`vuelume verify <dir>`) runs every supported edit on every element of a
   project in memory and checks the file is restored byte-for-byte. It is our regression harness for
   real-world code.

## Alternatives considered

- **Re-print the AST** (e.g. recast-style) — no maintained printer exists for Vue templates, and a
  printer would still risk normalizing formatting.
- **Regex/string manipulation without an AST** — impossible to do safely with directives, entities,
  multi-line values, comments containing tags, etc.
- **`magic-string`** — a fine library (compiler-sfc depends on it), but edits are few and simple,
  so a 20-line `applyTextEdits` is enough; it can be swapped in later if we need source maps.

## Consequences

- Diffs are minimal and reviewable; formatting is never touched.
- Each operation costs two parses (~ms per file): acceptable.
- Verification catches our own bugs: during development it rejected an edit where a directive name
  (`v-if`) had slipped through name validation.
- Undo/redo is natural: edits are invertible text patches.
