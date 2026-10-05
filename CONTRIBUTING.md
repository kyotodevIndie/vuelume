# Contributing

Thanks for helping! This project's first rule is **never corrupt the user's code**, so
correctness and tests matter more than features.

## Setup

```bash
pnpm install
pnpm check      # typecheck + lint + format check + tests (what CI runs)
```

Useful scripts:

| Command           | What                                                           |
| ----------------- | -------------------------------------------------------------- |
| `pnpm test`       | Vitest, runs against sources (no build needed)                 |
| `pnpm test:watch` | Watch mode                                                     |
| `pnpm typecheck`  | `tsc -b` for packages + type-check of tests                    |
| `pnpm lint`       | ESLint                                                         |
| `pnpm format`     | Prettier (write)                                               |
| `pnpm build`      | Build packages + editor UI (needed for the CLI and the editor) |
| `pnpm vuelume …`  | Run the built CLI                                              |

## Where things go

- New model types → `packages/project-model` (plain data only, no classes/functions in the model).
- Parsing/analysis/transformations → `packages/vue-code-engine` (**no `fs`**, pure functions).
- Anything touching the file system → `packages/project-analyzer`, the CLI or
  `packages/vite-plugin` (the only place that writes files from the editor).
- Editor UI → `apps/playground` (Vue). The UI never edits source text: it sends `Operation`s
  (see `packages/project-model/src/editing.ts`). Editor state lives in `src/editor.ts`.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) first; significant decisions need an ADR in `docs/adr/`.

## Running the editor

```bash
pnpm dev   # open the printed "vuelume editor" URL
```

`pnpm dev` (`scripts/dev.mjs`) runs `tsc -b --watch`, `vite build --watch` for the editor UI and
the example app. When a package used by the plugin is rebuilt, the example dev server restarts
by itself (Vite loads plugins only at startup); editor UI changes only need a page reload.

## Rules for transformations

Every transformation must:

1. refuse (with a `ReadonlyReason`) anything outside the safe subset instead of guessing;
2. produce minimal `TextEdit`s and preserve style (quotes, layout, indentation, EOL);
3. go through verification before returning a result — `verify()` for prop edits, the shape
   check (`finalize()` in `structure/operations.ts`) for structural ones;
4. come with tests: input → operation → exact expected output, refusal cases, and a round-trip
   case. If you touch escaping or layout, add a fixture under
   `packages/vue-code-engine/test/fixtures/` (it is automatically covered by `checkRoundTrip`).

Found a file where `vuelume verify` reports a failure? That is a bug — please open an issue with a
minimal `.vue` reproduction.

## Commits and pull requests

- Conventional Commits style: `feat(engine): …`, `fix(analyzer): …`, `docs: …`, `test: …`,
  `chore: …`. Scopes: `model`, `engine`, `analyzer`, `cli`, `example`, `repo`.
- Keep PRs focused; include tests; `pnpm check` must pass.
- Fixture files are excluded from Prettier and from Git EOL normalization on purpose.

## Releasing

All public packages share one version.

1. Bump the version in every `packages/*/package.json` and add an entry to `CHANGELOG.md`.
2. Commit (`chore: release vX.Y.Z`), push, and wait for CI to pass.
3. Publish a GitHub release `vX.Y.Z` (or run the **Release** workflow manually). The workflow
   builds, tests and runs `pnpm -r publish`, which skips versions already on npm and rewrites
   `workspace:*` dependencies to real versions. It needs the `NPM_TOKEN` secret and the `npm`
   environment approval.
