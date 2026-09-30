# ADR-0007: Tooling — TypeScript 6.0, Vitest, ESLint, Prettier

- Status: Accepted
- Date: 2026-09-29

## Decision

- **TypeScript `~6.0`**, not 7.x: typescript-eslint 8 supports `<6.1`. Revisit when typescript-eslint
  supports the native compiler. Strict mode plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. `module: NodeNext`, ESM only, target ES2024.
- **Build**: `tsc -b` with project references; no bundler (libraries ship plain ESM + `.d.ts`).
- **Tests**: Vitest, run from sources through an alias (`@vuelume/*` → `packages/*/src`), so no
  build is needed; `tsconfig.tests.json` type-checks tests.
- **Lint**: ESLint flat config, `typescript-eslint` strict (non type-aware for speed).
  `no-non-null-assertion` is off because `noUncheckedIndexedAccess` makes `arr[i]!` after a bounds
  check the idiomatic narrowing.
- **Format**: Prettier (no semicolons, single quotes, width 100). Fixture files are excluded: their
  odd formatting is the point.
- **Dependencies**: only `@vue/compiler-sfc`, `@vue/compiler-core` (types/enums), `@babel/parser`,
  `@babel/types` at runtime. The CLI uses `node:util.parseArgs` (no CLI framework).
- **Node**: `>=22.13`.

## Consequences

Small, conventional toolchain that contributors know. No framework is needed until Phase 4 (UI).
