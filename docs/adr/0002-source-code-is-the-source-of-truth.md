# ADR-0002: Source code is the source of truth; the AST is a read-only index

- Status: Accepted
- Date: 2026-09-29

## Context

Page builders usually store a proprietary document (JSON) and need a runtime to render it. The
brief rejects that: removing the tool must leave a normal Vue project.

The brief's flow reads "AST → transformations → `.vue` code", which suggests transforming an AST
and generating code from it. **That premise needs correcting**: Vue has no official printer that
turns a template AST back into template source (the compiler generates render functions, not
templates). Re-generating a template from an AST would also drop formatting, comments, attribute
order, quote styles and anything the tool does not model.

## Decision

- The `.vue` file on disk is the only persistent state. The tool keeps no side-car files and adds
  no runtime dependency to the user's project.
- The AST and the project model are a **derived, read-only index** of the source: they tell us
  _where_ things are (exact ranges) and _what_ they mean.
- Changes are expressed as minimal text edits located through that index (ADR-0003).
- After every write, the model is re-derived from the new source; there is no model→source sync.

## Consequences

- Code edits (VS Code) and visual edits are symmetric: both just change the file.
- No "export" step, no lock-in.
- Every feature must be implementable as a local, verifiable text edit — a healthy constraint that
  keeps unsupported cases read-only instead of lossy.
