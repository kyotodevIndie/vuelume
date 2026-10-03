# ADR-0010: Server-side undo/redo as versioned text patches

- Status: Accepted
- Date: 2026-10-03

## Context

Undo/redo must reflect real changes on disk (not UI snapshots), cover prop and structural edits,
and coexist with edits made in other editors.

## Decision

- History lives in the dev server (`EditorService`), next to the code that writes files.
- Every applied operation records its forward `TextEdit`s, the inverse edits (computed from the
  original text) and the file's content hash before and after. Undo applies the inverse only if the
  file is exactly at the "after" hash; redo applies the forward edits only at the "before" hash.
- If a file changed outside the editor, its entries no longer apply: they are dropped and the user
  gets an explicit message. Patches are never applied to content they were not computed for.
- History is linear across files (like a regular editor), bounded (200 entries) and labelled
  ("Move \<Card\>") for the UI; it records the selection before/after to restore it.

## Alternatives considered

- **Client-side snapshots** — would restore UI state, not files, and break with external edits.
- **Re-running inverse operations through the engine** — not every operation has a structural
  inverse expressible as an operation (e.g. restoring removed formatting); exact text patches do.

## Consequences

- Undo is exact (byte-identical restore, verified in tests and in the browser).
- History is lost when the dev server restarts; persistence can be added later if needed.
