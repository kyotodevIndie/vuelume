# Decisions

Architecture Decision Records live in [`docs/adr/`](docs/adr). Each ADR states the context,
the decision, the alternatives considered and the consequences. To propose a change, add a new
ADR (copy [`docs/adr/template.md`](docs/adr/template.md)) instead of editing an accepted one;
mark the old one as superseded.

| ADR                                                            | Title                                                               | Status   |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](docs/adr/0001-monorepo-and-package-boundaries.md)       | Monorepo layout and package boundaries                              | Accepted |
| [0002](docs/adr/0002-source-code-is-the-source-of-truth.md)    | Source code is the source of truth; the AST is a read-only index    | Accepted |
| [0003](docs/adr/0003-surgical-text-edits-with-verification.md) | Surgical text edits with re-parse verification (no AST re-printing) | Accepted |
| [0004](docs/adr/0004-parsers-and-static-script-analysis.md)    | Official parsers + our own static script analysis                   | Accepted |
| [0005](docs/adr/0005-safe-subset-refuse-rather-than-guess.md)  | Safe subset: refuse rather than guess                               | Accepted |
| [0006](docs/adr/0006-node-identity.md)                         | Node identity: element index paths per file                         | Accepted |
| [0007](docs/adr/0007-tooling.md)                               | Tooling: TypeScript 6.0, Vitest, ESLint, Prettier                   | Accepted |
| [0008](docs/adr/0008-canvas-source-mapping.md)                 | Canvas ↔ source mapping via dev-only compile-time instrumentation   | Proposed |
