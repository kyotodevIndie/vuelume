# ADR-0008: Canvas ↔ source mapping via dev-only compile-time instrumentation

- Status: **Accepted** (implemented in `@vuelume/vite-plugin`; was "Proposed" until 2026-09-29)
- Date: 2026-09-29, updated 2026-10-03

## Context

Selecting something in the preview must locate its node in the source. Vue keeps no element-level
source locations at runtime, one template node can render N instances (`v-for`), the node to edit
for a rendered `<ProductCard>` is its **usage site** in the parent file, slot content is authored in
the parent but rendered inside the child, and attributes injected on components fall through to
their root (or warn when there are several roots).

## Decision

A Vite plugin (`apply: 'serve'`, `enforce: 'pre'`) rewrites each project `.vue` module **in
memory** before `@vitejs/plugin-vue` compiles it (files on disk are never touched; a source map is
returned):

- native elements get `data-vl="<file>:<nodeId>"` — their authoring site, which is also correct
  for slot content;
- component usages get `data-vl-u-<hash(file)>="<file>:<nodeId>"`. The attribute name embeds the
  parent file so wrapper chains (`A` renders `<B>` as root) keep every level; usages of components
  known to render several roots are not marked (no "extraneous attrs" warnings);
- built-ins (`Transition`, `KeepAlive`, `component`, …), `<template>` and `<slot>` are skipped.

A small client runtime (served through Vite's pipeline, active only inside the editor iframe)
resolves a DOM element to `{ node, usages[] }`. The default pick is the nearest usage; Alt drills
into the native element.

The proposal's alternative of reading props from vnodes was not needed: DOM attributes proved
sufficient and simpler, and are inspectable in devtools.

## Consequences

- Precise, framework-agnostic selection, including `v-for` (all instances highlight) and slots.
- The app sees extra `data-*` attributes in dev only; components that enumerate `$attrs` could
  notice them (not observed so far).
- Compiled library components (non-`.vue`) are assumed single-root and are marked.
