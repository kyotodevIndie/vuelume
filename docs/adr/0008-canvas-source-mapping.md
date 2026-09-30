# ADR-0008: Canvas ↔ source mapping via dev-only compile-time instrumentation

- Status: **Proposed** (needs a spike before Phase 4)
- Date: 2026-09-29

## Context

"Selecting a component on the canvas must locate its node in the source." Vue does not keep
element-level source locations at runtime (only `__file` per component in dev). In addition:

- one template node can render **N** instances (`v-for`), or zero (`v-if`);
- the node to edit for a rendered `<ProductCard>` is its **usage site** in the parent file, not the
  `ProductCard.vue` definition;
- slot content is authored in the parent but rendered inside the child;
- injecting DOM attributes on components interferes with `inheritAttrs: false`, multi-root
  components and fragments (and can trigger "extraneous attrs" warnings).

## Proposed decision

A Vite dev-server plugin configures `@vitejs/plugin-vue` with an extra template `nodeTransform`
(dev only, never in production builds) that attaches `{ file, nodeId }` to every element/component
vnode (e.g. as a non-rendered prop read through `el.__vnode` / component instances), computed with
the **same** `NodeId` algorithm as the engine. The canvas walks from the clicked DOM element to the
nearest instrumented vnode.

Alternatives to evaluate in the spike: DOM `data-*` attributes (simple, but the problems above),
Vue devtools-style instance tree walking + `__file` + template re-matching (no instrumentation, but
imprecise for repeated nodes).

## Consequences

To be confirmed by the spike. The engine already provides the other half (`findElementById`,
`findElementAtOffset`, stable ids for prop edits).
