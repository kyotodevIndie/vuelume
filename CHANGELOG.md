# Changelog

All packages (`@vuelume/*`) share the same version.

## 0.1.0 — first preview release

- **Visual editor** served by `@vuelume/vite-plugin` at `/__vuelume/`: layers, insert palette,
  live preview with device sizes, inspector (props, text, classes, styles, attributes, slots),
  animated drag and drop, keyboard shortcuts, undo/redo.
- **Verified operations** on `.vue` files: set/remove props, set text, insert, remove, move,
  wrap and duplicate elements, with component imports. Every edit is re-parsed and checked before
  it is written; unsafe edits are refused with an explanation.
- **Analysis** of `<script setup>` components: props, emits, models, slots, imports and usages.
- **CLI** (`@vuelume/cli`): `inspect`, `tree`, `set-prop`, `remove-prop`, `verify`.
- Validated on 7 open-source Vue projects (~104k prop edits and ~281k structural operations in
  memory, 0 corrupted results).
