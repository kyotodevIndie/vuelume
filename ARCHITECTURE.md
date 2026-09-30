# Architecture

> Status: Phase 0–1 implemented, with a Phase 2/3 proof of concept (`setProp`/`removeProp`).
> Name: **vuelume** is a provisional name (see [ADR-0001](docs/adr/0001-monorepo-and-package-boundaries.md)).

## 1. Goal and principles

A visual IDE for **existing** Vue projects where **the `.vue` source code is the source of truth**.
There is no proprietary JSON and no runtime: if the tool is removed, the project stays a normal Vue app.

Principles, in order of priority:

1. **Never corrupt code.** When in doubt, refuse the edit and say "open in code".
2. **Minimal diffs.** Change only the bytes needed; never re-print or re-format a file.
3. **Preserve what is not understood.** Unknown syntax is kept untouched and reported.
4. **Code-first and visual-first coexist.** The engine is a pure function of the current source,
   so edits made in a text editor and in the visual editor are equally valid inputs.
5. **Core ≠ UI.** Analysis and transformations know nothing about the editor UI.
6. **Everything is tested**, especially transformations (unit, round-trip and fuzz-style tests).

## 2. Packages

```
packages/
  project-model      Types for the intermediate representation (+ tiny pure helpers). No deps.
  vue-code-engine    Pure: .vue source string ⇄ ComponentModel; safe transformations. No fs.
  project-analyzer   Node: discovers files, runs the engine per file, resolves cross-file links.
  cli                `vuelume inspect | tree | set-prop | remove-prop | verify`
examples/
  basic-shop         A real, runnable Vue 3 + Vite app used as the analysis/editing target.
```

Dependency direction is strictly one-way:

```
project-model  ←  vue-code-engine  ←  project-analyzer  ←  cli
                                                        ←  (future) vite plugin, editor UI, agents
```

- `vue-code-engine` has **no file system access** so it can run anywhere (Node, a Vite plugin,
  a web worker, a test). It takes a string, returns a model or a new string.
- `project-analyzer` is the only layer that reads directories; it never writes.
- Writing files is the job of the outermost layer (the CLI today, a Vite dev-server plugin later),
  which also owns concurrency checks (see §7).

Why no `apps/playground` yet: the brief's Phase 4 playground is the IDE UI. What Phases 0–1 need
is a _target project_ to analyze, which is `examples/basic-shop`. Mixing both would blur
"the tool" and "the project being edited". See ADR-0001.

## 3. Data flow

### Analysis (read)

```
.vue file ──@vue/compiler-sfc parse()──► SFC descriptor
                                            │
            ┌───────────────────────────────┴──────────────────────────────┐
            ▼                                                              ▼
  <template> raw parser AST                                   <script setup> / <script>
  (before compiler transforms:                                 Babel AST (@babel/parser via
   v-if/v-for are still directives)                            compiler-sfc's babelParse)
            │                                                              │
            ▼                                                              ▼
  TemplateModel: elements, attributes,                  props, emits, defineModel, defineOptions,
  flags, editability, exact ranges                      imports, template bindings
            └───────────────────────────────┬──────────────────────────────┘
                                            ▼
                                     ComponentModel  (JSON-serializable)
                                            │   project-analyzer: resolve imports → files
                                            ▼
                                      ProjectModel
```

### Transformation (write)

```
source + operation (nodeId, prop, value)
   │
   1. parse → refuse if the file has parse errors
   2. locate node by NodeId → refuse if not found
   3. apply safe-subset rules → refuse with a ReadonlyReason
   4. compute a minimal TextEdit (keep quotes, binding form, layout, EOL)
   5. apply edit
   6. VERIFY: re-parse the result and check
        - it parses without errors
        - nothing outside the element's start tag changed
        - same element (id + tag), same subtree size
        - every other attribute is byte-identical and in order
        - the targeted prop now has exactly the requested value
      → any failure: reject, return the original untouched
   ▼
new source + edits
```

The verification step is the core safety mechanism: the transformation logic may have bugs,
but a buggy edit cannot silently reach disk. (During development, it caught a `v-if` "prop name"
that slipped past validation.)

### Future IDE loop (not implemented)

```
 Editor UI ── operation ──► Vite dev-server plugin ── engine.setProp ──► write .vue
    ▲                                                                         │
    └──────── canvas re-renders ◄── Vite HMR (template-only → rerender) ◄─────┘
```

HMR was verified manually on `examples/basic-shop`: after `vuelume set-prop … --write`, Vite
performed an `hmr update` (no page reload) and component state was preserved.

## 4. The project model

Defined in `packages/project-model`. Key points:

- **Ranges** are `{ start, end }` with a 0-based UTF-16 `offset` (matches JS strings) plus 1-based
  `line`/`column`. Script (Babel) and template (Vue) offsets are normalized to whole-file offsets.
- **`TemplateElementNode`** keeps `range`, `startTagRange`, `elementType`
  (`element | component | slot | template`), `flags`
  (`conditional | repeated | dynamic-component | spread-binding | model-binding | slot-content`)
  and `attributes`.
- **Attributes** are a discriminated union:
  `static` (`title="x"`, valueless `disabled`), `bind` (`:price="4999"`, `v-bind="obj"`),
  `on` (`@click`), `directive` (`v-if`, `v-for`, `v-model`, `#slot`, custom).
  Each carries `editable` and, if not, a `readonlyReason`.
- **`ComponentModel`** has props (type text as written + a `kind` for choosing Inspector widgets,
  enum `options`, `required`, `default`), emits, slots, imports, usages (tag → binding → import →
  resolved file) and diagnostics.
- Everything is plain data (tested with a JSON round-trip), so the model can cross process
  boundaries (dev server ↔ UI ↔ AI agents).

### Node identity

`NodeId` = path of **element** indices from the template root, e.g. `"1.2"`. Global identity is
`{ file, nodeId }`. Text/comment/attribute edits never change ids; structural edits (insert,
remove, move) do. That is acceptable because every operation is applied to the current source and
the model is re-derived after each write; a future editor session keeps selection by re-mapping ids
after structural operations (see ADR-0006).

## 5. Safe subset (current rules)

| Situation                                                 | Visual prop editing                    |
| --------------------------------------------------------- | -------------------------------------- |
| `title="x"`, `title='x'`, `title=x`, valueless `featured` | ✅ editable                            |
| `:price="4999"`, `:title="'x'"`, `:ok="true"`, `:n="-1"`  | ✅ editable (literal binding)          |
| `:title="product.name"` or any non-literal                | ⚠ `advanced-binding` (removal allowed) |
| `:[name]="x"`                                             | ⚠ `dynamic-argument`                   |
| `:title.prop`, `.camel`, `.attr`                          | ⚠ `modifiers`                          |
| element has `v-bind="obj"`                                | ⚠ `spread-binding` (all props)         |
| prop driven by `v-model` / `v-model:arg`                  | ⚠ `model-binding`                      |
| same prop written twice (`class` + `:class`)              | ⚠ `duplicate`                          |
| `is`, `key`, `ref`                                        | ⚠ `reserved`                           |
| `v-if`/`v-for`/`v-slot` on the element                    | props editable; element is flagged     |
| `<template lang="pug">`, `<template src>`                 | whole template unsupported             |
| file with parse errors                                    | nothing is edited                      |

Writing rules:

- existing static attribute + string → replace the value, keep the quote style (switch quotes only
  if the value contains the quote), keep unquoted style when the value allows it;
- existing literal binding → replace the literal, keep the binding form and inner quote style;
- number/boolean on a static attribute → becomes a binding (`:price="20"`);
- new attribute → after the last attribute; on a new line with the same indentation if the last
  attribute is on its own line, otherwise on the same line; the file's EOL is used (CRLF safe);
- `true` for a new boolean prop is written as `:featured="true"`, never the shorthand, because the
  shorthand is only `true` for props declared `Boolean` (the engine does not assume the child type).

## 6. Script analysis

Own static analysis over the Babel AST (ADR-0004), supporting:

- `defineProps<{...}>()`, `defineProps<Props>()` with **local** interfaces/type aliases,
  `extends` of local interfaces, intersections;
- runtime `defineProps({...})` (constructors, `{ type, required, default }`, `as PropType<T>`),
  `defineProps([...])`;
- defaults from `withDefaults(…, {...})` and Vue 3.5 destructuring (`const { a = 1 } = defineProps()`);
- `defineEmits` (call signatures, named tuples, array/object), `defineModel`, `defineOptions({ name })`;
- imports and top-level bindings, used to resolve template tags like Vue's compiler does
  (`product-card` → `ProductCard`).

Reported, not guessed: imported prop types, generics/utility types, Options API
(detected via `export default {}` / `defineComponent({})`), `<script src>`, syntax errors.

## 7. Concurrency and the file system

The engine is pure: `(source, operation) → newSource`. The caller must guarantee that `source` is
what is on disk when writing. The CLI re-reads the file before writing and aborts if it changed.
The future dev-server plugin should use the same optimistic check (content hash per operation), so
that edits in VS Code and in the visual editor can interleave safely.

## 8. Extension points (planned)

The package split is chosen so these can be added without touching the core:

- **Component metadata providers** — e.g. a heavier provider based on `vue-component-meta`
  (Volar/TypeScript) for imported/generic prop types, or library presets (PrimeVue, Vuetify).
- **Transformations** — new operations follow the same pattern (locate → rules → edit → verify).
- **Plugins** (`definePlugin({ panels, inspectors, transforms, commands })`) live at the editor
  level and consume the engine API; plugins never bypass verification.

## 9. Technical risks

See [ROADMAP.md](ROADMAP.md#risks) for the prioritized list with mitigations.
