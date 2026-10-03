import type { NodeRef } from './template.js'

/**
 * Canvas protocol: shared constants and message shapes between the instrumented app (inside the
 * preview iframe), the editor UI and the dev server. Plain data + tiny pure helpers, so the
 * browser runtime and the UI can use it without pulling anything else.
 */

/** Attribute on native elements: `data-vl="src/App.vue:1.2"` (authoring site of the element). */
export const NODE_ATTRIBUTE = 'data-vl'

/**
 * Prefix of the attribute on component usages: `data-vl-u-<hash>="src/App.vue:1.1"`.
 * The name embeds a hash of the parent file so fallthrough attributes of wrapper components
 * (`A` renders `<B>` as its root) do not overwrite each other; every level is kept.
 */
export const USAGE_ATTRIBUTE_PREFIX = 'data-vl-u-'

export const BASE_PATH = '/__vuelume/'
export const API_PATH = `${BASE_PATH}api/`

/** What a click/hover in the preview resolves to. */
export interface CanvasTarget {
  /** Innermost instrumented native element (authoring site, including slot content). */
  node: NodeRef | null
  /** Component usages enclosing the target, innermost first. */
  usages: NodeRef[]
}

/** Drop position in the canvas; `inside` maps to the `last-child` structural position. */
export type DropPosition = 'before' | 'after' | 'inside'

export interface KeyInput {
  key: string
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod: boolean
  shift: boolean
  alt: boolean
}

export type EditorToPreview =
  | { type: 'vuelume:inspect'; enabled: boolean }
  | { type: 'vuelume:highlight'; target: NodeRef | null; label?: string }
  /** A palette item is being dragged in the editor: the preview shows drop indicators. */
  | { type: 'vuelume:drag'; active: boolean }

export type PreviewToEditor =
  | { type: 'vuelume:ready' }
  | { type: 'vuelume:select'; target: CanvasTarget }
  /**
   * Something was dropped on the canvas: a palette item (`insert`) or the selected element,
   * dragged inside the preview (`move`, with its source locator).
   */
  | {
      type: 'vuelume:drop'
      mode: 'insert' | 'move'
      target: NodeRef
      position: DropPosition
      source?: NodeRef
    }
  /** Editor shortcuts pressed while the preview has focus. */
  | { type: 'vuelume:key'; input: KeyInput }
  /** Vite applied an HMR update (edits from the editor or from any other tool). */
  | { type: 'vuelume:updated'; files: string[] }

export function encodeLocator(locator: NodeRef): string {
  return `${locator.file}:${locator.nodeId}`
}

export function decodeLocator(value: string | null | undefined): NodeRef | null {
  if (!value) return null
  const index = value.lastIndexOf(':')
  if (index <= 0) return null
  return { file: value.slice(0, index), nodeId: value.slice(index + 1) }
}

/** Small stable hash (FNV-1a, base36) used to make usage attribute names unique per file. */
export function fileHash(file: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < file.length; i++) {
    hash ^= file.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
