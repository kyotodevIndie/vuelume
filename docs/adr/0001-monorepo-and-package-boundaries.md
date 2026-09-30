# ADR-0001: Monorepo layout and package boundaries

- Status: Accepted
- Date: 2026-09-29

## Context

The brief suggested `packages/{vue-code-engine,project-analyzer,project-model}` and
`apps/playground`. The core must not depend on any UI, must be testable in isolation and must be
reusable by a future Vite plugin, an editor UI and AI agents.

## Decision

pnpm workspace with:

- `packages/project-model` — types of the intermediate representation plus pure traversal helpers.
  No dependencies. Everything JSON-serializable.
- `packages/vue-code-engine` — pure functions over a source string: analysis and transformations.
  **No file system access.**
- `packages/project-analyzer` — the only layer that reads directories; resolves cross-file links.
- `packages/cli` — `vuelume` command (added: the brief's `tool inspect` needed a home, and a CLI is
  the cheapest way to exercise the engine end to end before any UI exists).
- `examples/basic-shop` — a real Vite + Vue app used as the analysis/editing target and in tests.
- `apps/playground` — **deferred to Phase 4**. It is the IDE UI; in Phases 0–1 an empty app would
  only add maintenance. The "project being edited" (`examples/*`) and "the tool's UI" (`apps/*`)
  stay separate concepts.

The provisional name is `vuelume` (npm scope `@vuelume/*`, CLI `vuelume`). Renaming later means
replacing the scope and the `CLI_NAME` constant in `packages/cli/src/main.ts`.

## Alternatives considered

- **Single package** — simpler, but would couple file system code and future UI concerns to the
  engine, and make browser/worker usage harder.
- **Merging analyzer into engine** — rejected to keep the engine pure (no `fs`), which is what makes
  it trivially testable and embeddable.

## Consequences

- Clear, one-way dependency graph: model ← engine ← analyzer ← cli/plugins/UI.
- Packages build with `tsc -b` (project references). Tests run from source via a Vitest alias,
  so `pnpm test` needs no build.
