# ADR-0005: Safe subset — refuse rather than guess

- Status: Accepted
- Date: 2026-09-29

## Context

"It is better not to allow a visual edit than to generate incorrect code." We need an explicit,
testable definition of what is editable.

## Decision

- Each attribute in the model carries `editable` and a machine-readable `readonlyReason`
  (`advanced-binding`, `dynamic-argument`, `modifiers`, `spread-binding`, `model-binding`,
  `duplicate`, `reserved`, `directive`). The UI renders these as "⚠ … — Open in code".
- Transformations re-check the same rules and fail with `{ code: 'readonly', reason }`.
- Elements carry `flags` (`conditional`, `repeated`, `dynamic-component`, `spread-binding`,
  `model-binding`, `slot-content`) that inform the UI and future structural operations without, by
  themselves, blocking prop edits (editing `title="x"` on a `v-for` element is textually safe; the
  UI must explain it affects every instance).
- Only literal values are written in this phase (`string | number | boolean`).
- Files with parse errors are never edited. Non-HTML templates and `src` imports are unsupported.
- Analysis never fails on user code: unknown constructs become diagnostics, and `propsComplete`
  tells consumers when a prop list may be partial.

## Consequences

- Some legitimate edits are refused today (e.g. adding a prop to an element with `v-bind="obj"`).
  Each rule can be relaxed later with tests, never silently.
- The rule table in ARCHITECTURE.md §5 is the contract; tests cover every row.
