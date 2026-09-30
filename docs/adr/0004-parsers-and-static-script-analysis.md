# ADR-0004: Official parsers + our own static script analysis

- Status: Accepted
- Date: 2026-09-29

## Context

We need template structure with exact locations, and component APIs (props, emits, ...) from
`<script setup>`, as the author wrote them.

## Decision

- **Templates**: `@vue/compiler-sfc`'s `parse()` and the **raw parser AST** (`descriptor.template.ast`),
  read _before_ compiler transforms. At that stage `v-if`/`v-for` are still directives on their
  element, attribute values are decoded, and every node has `loc` with whole-file offsets.
  We depend on `@vue/compiler-core` only for its AST types/enums.
- **Scripts**: Babel AST via `babelParse` (re-exported by compiler-sfc) and `@babel/parser`, with our
  own static analysis of compiler macros (`defineProps`, `withDefaults`, `defineEmits`,
  `defineModel`, `defineOptions`) and local type declarations.

## Alternatives considered

- **`compileScript()` + its type inference (`inferRuntimeType`, `extractRuntimeProps`)** — gives
  runtime types (`String`), losing what the Inspector needs (`'small' | 'medium' | 'large'`); may
  throw on unsupported constructs; needs TypeScript registered for imported types; partially
  internal API. Worth revisiting for cross-file resolution (`resolveTypeElements` with an `fs`).
- **Volar / `vue-component-meta`** — the most complete (full TypeScript checker), but needs a TS
  program and tsconfig, is slow to start and heavy. Planned as an optional _metadata provider_ for
  cases the static analysis reports as unresolved.
- **Writing our own template parser** — no: the official parser defines what is valid Vue.

## Consequences

- Fast, dependency-light, never executes or type-checks user code.
- Prop types keep the author's text plus a coarse `kind`/`options` for widgets.
- Imported/generic/utility types are **reported**, not guessed (`props/imported-type`, ...).
