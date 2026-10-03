# ADR-0011: Editor UI architecture

- Status: Accepted
- Date: 2026-10-03

## Context

The editor needs layers, a palette, drag and drop, a live preview and an inspector, without
manipulating source text in the UI and without replacing the real preview.

## Decision

- **Served by the dev server** at `/__vuelume/`, with the user's app in a same-origin iframe at
  `/` — the preview is the real app with HMR, never a re-creation.
- **One store** (`apps/playground/src/editor.ts`) owns editor state (project, snapshots per file,
  selection, history, drag payload, device, toasts) and is the only place that calls the API.
  Components emit intent; every source change is an `Operation`.
- **Protocol in `project-model`** (`editing.ts`, `canvas.ts`): the UI depends on types only.
- **Drag & drop**: HTML5 DnD for the palette and layers (works across the same-origin iframe);
  pointer-based dragging of the selected element inside the canvas. Drop positions are
  before / after / inside; validity is pre-checked locally (self/descendant, void elements) and
  finally enforced by the engine/service, whose errors are shown as toasts.
- **External changes**: the preview runtime forwards Vite's `vite:afterUpdate` events, so the UI
  re-reads affected files even when they were edited elsewhere.
- No UI framework beyond Vue; no component library; a small inline icon set.

## Consequences

- The UI cannot corrupt code by construction; all safety lives in the engine/service.
- Each drop may be refused after the fact (e.g. a slot the component does not render); the
  feedback is immediate but the indicator does not yet know every server-side rule.
