import type { ComponentModel } from './component.js'
import type { NodeId } from './template.js'

/**
 * Editing protocol shared by the code engine, the dev-server API and the editor UI.
 * Plain data only: every operation is serializable and replayable.
 */

/** A literal value the editor can write into a template. */
export type EditValue = string | number | boolean

/** Description of a node to create (see the engine's `renderSpec`). */
export interface NodeSpec {
  /** `div`, `ProductCard`, `product-card`, or `template` together with `slot`. */
  tag: string
  /** Static attributes (strings) or literal bindings (numbers/booleans → `:name="1"`). */
  attributes?: { name: string; value: EditValue }[]
  /** Static text content. */
  text?: string
  /** Only with `tag: 'template'`: a slot template `<template #name>`. */
  slot?: string
}

export type InsertPosition = 'before' | 'after' | 'first-child' | 'last-child'

/** `nodeId: null` addresses the template root (only `first-child` / `last-child`). */
export interface StructuralTarget {
  nodeId: NodeId | null
  position: InsertPosition
}

export type Operation =
  | { op: 'setProp'; nodeId: NodeId; name: string; value: EditValue }
  | { op: 'removeProp'; nodeId: NodeId; name: string }
  | { op: 'setText'; nodeId: NodeId; text: string }
  | {
      op: 'insertNode'
      target: StructuralTarget
      node: NodeSpec
      /** Inserting a project component: its file. The server adds/reuses the import. */
      component?: { file: string }
    }
  | { op: 'removeNode'; nodeId: NodeId }
  | { op: 'moveNode'; nodeId: NodeId; target: StructuralTarget }
  | { op: 'wrapNode'; nodeId: NodeId; wrapper: NodeSpec }
  | { op: 'duplicateNode'; nodeId: NodeId }

export interface OperationRequest {
  file: string
  /** Version (content hash) of the file the client computed the operation against. */
  version: string
  operation: Operation
  /** Current selection, restored when the operation is undone. */
  selection?: NodeId | null
}

export interface HistoryItem {
  id: number
  file: string
  label: string
}

export interface HistoryState {
  /** Most recent first. */
  undo: HistoryItem[]
  redo: HistoryItem[]
}

export interface ComponentSnapshot {
  model: ComponentModel
  /** Content hash of the source the model was computed from (optimistic concurrency token). */
  version: string
}

export interface EditError {
  code: string
  message: string
  reason?: string
}

export type OperationResponse =
  | {
      ok: true
      file: string
      changed: boolean
      snapshot: ComponentSnapshot
      /** Node to select afterwards (inserted/moved/edited node), if any. */
      nodeId: NodeId | null
      history: HistoryState
    }
  | { ok: false; error: EditError; history?: HistoryState }
