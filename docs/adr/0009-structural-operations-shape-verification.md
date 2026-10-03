# ADR-0009: Structural operations verified by template shape

- Status: Accepted
- Date: 2026-10-03

## Context

Insert / remove / move / wrap / duplicate / set-text change the template structure, so the
start-tag verification used for props (ADR-0003) does not apply. Text-level bugs here (wrong
indentation inside `<pre>`, content lost when moving, a node landing between `v-if` and `v-else`)
would silently change behavior.

## Decision

1. Each operation is computed as minimal `TextEdit`s on the original source, following the file's
   layout (indentation unit, one-per-line vs inline, EOL, blank-line rhythm). `moveNode` computes
   the removal and the insertion on the same original source and applies them together — never
   "remove, then insert" (atomic).
2. Before returning, the operation is **applied to the shape of the original template** — a
   formatting-free tree of tags, canonical attributes, text (whitespace-collapsed except in
   `<pre>`/`<textarea>`), interpolations and comments (whitespace-insensitive). The re-parsed result
   must have **exactly** that shape; other blocks must be unchanged; a requested import must be
   present. Otherwise the operation is rejected and nothing is written.
3. Invalid positions are rejected up front with explicit codes (`conditional-chain`,
   `invalid-target`, `invalid-spec`, `import-conflict`, `no-script-setup`, `dynamic-content`)
   so the UI can explain them.

## Alternatives considered

- **AST re-printing** — no Vue template printer, loses formatting (ADR-0002).
- **Only re-parse-without-errors** — too weak: a misplaced or duplicated node still parses.

## Consequences

- Validation over 7 real projects: ~281k operations in memory, 0 accepted wrong results. The first
  runs found 67 cases the verification rejected (multi-line comments, `<pre>` whitespace); the
  causes were fixed and turned into tests — the safety net worked as intended.
- Each operation re-parses the file (≈ milliseconds; ~10–40 ms on a 165 KB template).
