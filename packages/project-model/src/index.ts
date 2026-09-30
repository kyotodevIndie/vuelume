/**
 * @vuelume/project-model
 *
 * The intermediate representation shared by every other package.
 *
 * Rules for this package:
 * - No runtime dependencies, no Node/browser APIs.
 * - Everything must be plain, JSON-serializable data (no classes, Maps or functions),
 *   so the model can cross process boundaries (Vite dev server ↔ editor UI ↔ agents).
 */
export type * from './source.js'
export type * from './template.js'
export type * from './component.js'
export type * from './project.js'

export { walkElements, findElementById, findElementAtOffset } from './traverse.js'
export * from './canvas.js'
