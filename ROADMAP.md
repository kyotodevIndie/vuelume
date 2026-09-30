# Roadmap

Legend: ✅ done · 🟡 partial / proof of concept · ⬜ not started

## Phase 0 — Bootstrap ✅

- ✅ pnpm monorepo, TypeScript strict (TS 6.0), project references
- ✅ Vitest, ESLint (flat config + typescript-eslint), Prettier, EditorConfig
- ✅ GitHub Actions CI (typecheck, lint, format, test, build, example build)
- ✅ README, CONTRIBUTING, ARCHITECTURE, ROADMAP, ADRs

## Phase 1 — Project Analyzer ✅

- ✅ Discover `.vue`/`.ts`/`.js` files (ignores `node_modules`, `dist`, hidden dirs)
- ✅ `<script setup>`: `defineProps` (type-based with local types, runtime object/array),
  `withDefaults`, reactive destructure defaults, `defineEmits`, `defineModel`, `defineOptions`
- ✅ Imports, template bindings, component usages resolved to files (relative + explicit aliases)
- ✅ Slots declared via `<slot>` outlets
- ✅ `vuelume inspect <dir>` (text and `--json`)
- 🟡 Options API: detected and reported, not analyzed
- ⬜ Aliases read automatically from `tsconfig`/`vite.config`
- ⬜ Cross-file prop types (`defineProps<ImportedProps>()`), generics (`generic="T"`)
- ⬜ Global components (`app.component`), auto-imports (`unplugin-vue-components`)

## Phase 2 — AST / Project Model 🟡 (base done)

- ✅ Template model with exact ranges, node ids, attribute kinds, flags, editability
- ✅ Source ↔ node: `findElementById`, `findElementAtOffset`; `vuelume tree <file>`
- ⬜ Runtime (canvas) ↔ node mapping — **needs a spike, highest remaining risk**

## Phase 3 — Safe transformations 🟡

- ✅ `setProp`, `removeProp` with re-parse verification
- ✅ `checkRoundTrip` / `vuelume verify <dir>`: in-memory stress test on any project
- ⬜ `insertNode`, `removeNode`, `moveNode`, `wrapNode` (same verify pattern + id re-mapping)
- ⬜ Events (`addEvent`/`removeEvent`), text content, slots

## Phase 4 — Minimal playground ⬜

`Component Tree | Preview | Inspector`, served by a Vite dev-server plugin that owns writes
(with optimistic concurrency) and relies on HMR (verified to work: template edits rerender
without page reload and keep component state).

## Later

Drag-and-drop, full component tree, CSS/Tailwind, responsive preview, router/Pinia awareness,
Nuxt, undo/redo (operations are already invertible text edits), plugin API, component library
presets (PrimeVue, Vuetify, shadcn-vue), AI/MCP operating on the structured operations.

## Recommended next steps (in order)

1. **Corpus validation.** Run `vuelume verify` and `vuelume inspect` on 5–10 real open-source Vue
   projects of different styles; turn every failure into a fixture. Cheap, and it is the best
   evidence for "never corrupt code".
2. **Canvas ↔ source spike.** Dev-only template instrumentation through `@vitejs/plugin-vue`
   `compilerOptions.nodeTransforms`, mapping rendered instances to `{ file, nodeId }` of the
   _usage site_. Must handle `v-for` (1 node → N instances), slot content (authored in the parent),
   multi-root components and `inheritAttrs: false`.
3. **Cross-file types** for the Inspector (imported prop types, aliases from tsconfig/vite), either
   via `@vue/compiler-sfc`'s type resolver with a file system, or a `vue-component-meta` provider.
4. **Structural operations** (`insertNode`/`removeNode`/`moveNode`) with verification.
5. **Phase 4 playground** on top of 2–4.

## Risks

| #   | Risk                                                                                                                                                                                                                                   | Impact  | Mitigation / status                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| R1  | Runtime → source mapping for the canvas: Vue keeps no element-level source locations at runtime; one node renders N instances; slot content belongs to the parent file; injected attributes can break `inheritAttrs:false`/multi-root. | High    | Spike (next step 2). Instrument at compile time, dev-only, read from vnodes rather than DOM attributes where possible. |
| R2  | Prop types from other files / generics / global & auto-imported components.                                                                                                                                                            | Medium  | Reported today, never guessed. Add resolver or `vue-component-meta` provider.                                          |
| R3  | Structural edits change `NodeId`s.                                                                                                                                                                                                     | Medium  | Ids are re-derived after each write; editor keeps selection by re-mapping.                                             |
| R4  | Concurrent edits (text editor + visual editor).                                                                                                                                                                                        | Medium  | Engine is pure; writer checks content hash before writing (CLI already does).                                          |
| R5  | Parser drift: the project's Vue version ≠ the tool's compiler version.                                                                                                                                                                 | Low/Med | Parser output is stable since 3.4; pin `^3.5`; corpus tests.                                                           |
| R6  | Semantics the text can't show (Boolean prop casting, `v-bind` object order, fallthrough attrs).                                                                                                                                        | Medium  | Conservative rules (explicit `:x="true"`, spread → read-only); use child prop types when available.                    |
| R7  | Project formatting conventions (Prettier) for inserted code.                                                                                                                                                                           | Low     | Follow local layout; optional "format touched range" later.                                                            |
| R8  | Performance on large projects.                                                                                                                                                                                                         | Low     | Per-file, synchronous, ms-level; add content-hash cache and incremental re-analysis.                                   |
