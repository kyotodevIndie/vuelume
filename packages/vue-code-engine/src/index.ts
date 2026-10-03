/**
 * @vuelume/vue-code-engine
 *
 * Pure (no file system, no UI) engine that
 * - analyzes a `.vue` source string into the project model, and
 * - applies safe, minimal, verified text transformations to it.
 */
export { analyzeComponent, type AnalyzeOptions } from './analyze.js'
export {
  setProp,
  removeProp,
  type PropValue,
  type PropTarget,
  type SetPropOptions,
  type TransformResult,
  type TransformError,
  type TransformErrorCode,
} from './transform/props.js'
export { applyTextEdits, type TextEdit } from './transform/edits.js'
export {
  insertNode,
  removeNode,
  moveNode,
  wrapNode,
  duplicateNode,
  setText,
  type InsertPosition,
  type StructuralTarget,
  type InsertNodeOptions,
  type RemoveNodeOptions,
  type MoveNodeOptions,
  type WrapNodeOptions,
  type DuplicateNodeOptions,
  type SetTextOptions,
} from './structure/operations.js'
export {
  renderSpec,
  specProblem,
  VOID_ELEMENTS,
  type NodeSpec,
  type SpecValue,
} from './structure/markup.js'
export type { ImportRequest } from './structure/imports.js'
export { checkRoundTrip, type RoundTripReport, type RoundTripFailure } from './verify/round-trip.js'
export { readLiteral } from './literals.js'
export { camelize, pascalize, componentNameFromFile } from './names.js'
export { LineIndex } from './positions.js'
