# Roadmap

Legend: ✅ done · 🟡 partial · ⬜ not started

## Foundation (Phases 0–3) ✅

- ✅ Monorepo, strict TypeScript, Vitest, ESLint, Prettier, CI (Linux + Windows, Node 22/24)
- ✅ Project analyzer: `<script setup>` props/emits/models/slots, imports, usages → files
- ✅ Template model with exact ranges, node ids, editability; `vuelume inspect | tree | verify`
- ✅ Verified prop edits (`setProp`, `removeProp`), incl. static `class`/`style` next to bound ones
- ✅ Corpus validation on 7 open-source projects ([report](docs/reports/corpus-validation.md))

## Visual editor ✅ (first usable version)

- ✅ Structural engine: `insertNode`, `removeNode`, `moveNode` (atomic), `wrapNode`,
  `duplicateNode`, `setText`, verified by template shape (ADR-0009); component imports
- ✅ Undo/redo as versioned text patches, safe with external edits (ADR-0010)
- ✅ Dev-only Vite plugin: preview instrumentation (ADR-0008), versioned editing API
- ✅ Editor UI (ADR-0011): layers (expand/collapse, drag to reorder/nest), insert palette
  (search, project components + HTML, required-props dialog), live preview (device sizes,
  hover/selection labels, drop indicators, drag inside the canvas), inspector (props, text,
  classes, styles, attributes, slots, read-only directives), toolbar actions, keyboard shortcuts,
  resizable panels, change indicator, external-change sync

## Next

1. ⬜ **Publishable packages**: bundle the UI into `@vuelume/vite-plugin` (today it resolves the
   private `@vuelume/playground` package), npm metadata, changesets/releases.
2. ⬜ **Analysis gaps found in the corpus**: aliases from `tsconfig`/Vite in the CLI/analyzer,
   Options API props, imported prop types (directus resolves 460/4,580 usages without aliases;
   PrimeVue is 66% Options API).
3. ⬜ **Editor depth**: event handlers (add `@click` to a method), `v-if`/`v-for` authoring with
   expression inputs, editing inside `v-for` items' text, multi-select, copy/paste between files,
   cross-file moves (with import management), smarter drop validity in the canvas (server
   pre-check while dragging).
4. ⬜ **Styling**: class suggestions (Tailwind/UnoCSS awareness), computed-style hints, scoped
   `<style>` editing.
5. ⬜ **Docs site** (VitePress) and a landing page.

## Later

Responsive variants, router/Pinia awareness, Nuxt, plugin API (`definePlugin`), component library
presets (PrimeVue, Vuetify, shadcn-vue), persistent history, AI/MCP operating on `Operation`s.

## Risks

| #   | Risk                                                                                       | Impact  | Mitigation / status                                                          |
| --- | ------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| R1  | Prop types from other files / generics / globals not known → Inspector shows fewer widgets | Medium  | Reported, never guessed; add type resolver or `vue-component-meta` provider  |
| R2  | Canvas drop indicator accepts positions the server later refuses                           | Low     | Clear error toast; add server pre-check during drag                          |
| R3  | `data-vl*` attributes visible to components that enumerate `$attrs` (dev only)             | Low     | Multi-root components skipped; consider vnode-based markers if issues appear |
| R4  | History lost on dev-server restart                                                         | Low     | Documented; persist later if needed                                          |
| R5  | Parser drift (project Vue version ≠ tool's compiler)                                       | Low/Med | Pinned `^3.5`; corpus re-runs                                                |
| R6  | Very large templates: each op re-parses the file                                           | Low     | ~10–40 ms on a 165 KB template; cache parse by content hash if needed        |
