# ADR-0006: Node identity — element index paths per file

- Status: Accepted
- Date: 2026-09-29

## Context

The UI, the canvas and agents need to refer to "this element". Offsets change on every edit;
random ids would need to be stored somewhere, and we store nothing outside the source (ADR-0002).

## Decision

- `NodeId` is the path of element indices from the template root (`"1.2.0"`), counting only
  element nodes. Global identity is `NodeRef { file, nodeId }`.
- Ids are derived, never stored. Operations carry the id computed from the source they were
  computed against.

## Consequences

- Stable under text, comment and attribute edits (the only edits implemented now).
- Structural operations (insert/remove/move) shift sibling ids. Those operations will return the
  id mapping they cause, so an editor session can re-map selection; together with content-hash
  checks (ARCHITECTURE §7) an operation computed against stale ids is rejected, not misapplied.
- Human-readable and deterministic, which helps debugging, tests and AI agents.
