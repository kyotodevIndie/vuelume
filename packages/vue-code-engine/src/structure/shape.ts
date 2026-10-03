import type { TemplateAttribute, TemplateChildNode } from '@vuelume/project-model'

/**
 * The "shape" of a template: tags, attributes (canonical text), text, interpolations and
 * comments — everything that matters semantically, nothing about formatting.
 *
 * Structural operations are verified by applying the same operation to the shape of the
 * original file (pure tree manipulation) and requiring that the shape of the re-parsed result
 * is identical. Any text-level mistake (lost content, broken nesting, misplaced node) shows up
 * as a difference and the operation is rejected before anything is written.
 */
export type Shape = ShapeElement | ShapeLeaf

export interface ShapeElement {
  t: 'el'
  tag: string
  attrs: string[]
  children: Shape[]
  /** NodeId in the source the shape was built from (ignored when comparing). */
  id?: string
  /** Whitespace inside is significant (`<pre>`, `<textarea>`). */
  raw?: boolean
}

export interface ShapeLeaf {
  t: 'text' | 'interp' | 'comment'
  v: string
}

const RAW_WHITESPACE = new Set(['pre', 'textarea'])

export function buildShape(nodes: TemplateChildNode[], raw = false): Shape[] {
  return nodes.map((node): Shape => {
    switch (node.type) {
      case 'element': {
        const isRaw = raw || RAW_WHITESPACE.has(node.tag)
        return {
          t: 'el',
          tag: node.tag,
          attrs: node.attributes.map(canonicalAttribute),
          children: buildShape(node.children, isRaw),
          id: node.id,
          ...(isRaw ? { raw: true } : {}),
        }
      }
      case 'text':
        return { t: 'text', v: node.content }
      case 'interpolation':
        return { t: 'interp', v: node.expression.trim() }
      case 'comment':
        return { t: 'comment', v: node.content.trim() }
    }
  })
}

function canonicalAttribute(attr: TemplateAttribute): string {
  const modifiers = attr.kind === 'static' ? '' : attr.modifiers.map((m) => `.${m}`).join('')
  switch (attr.kind) {
    case 'static':
      return attr.value === null ? attr.name : `${attr.name}=${JSON.stringify(attr.value)}`
    case 'bind':
      return `:${attr.dynamicName ? `[${attr.name}]` : (attr.name ?? '')}${modifiers}=${attr.expression?.trim() ?? ''}`
    case 'on':
      return `@${attr.dynamicName ? `[${attr.event}]` : (attr.event ?? '')}${modifiers}=${attr.expression?.trim() ?? ''}`
    case 'directive':
      return `v-${attr.name}:${attr.dynamicArg ? `[${attr.arg}]` : (attr.arg ?? '')}${modifiers}=${attr.expression?.trim() ?? ''}`
  }
}

/** Formatting-insensitive serialization used for comparisons. */
export function serializeShape(shapes: Shape[], raw = false): string {
  return JSON.stringify(normalize(shapes, raw))
}

function normalize(shapes: Shape[], raw: boolean): unknown[] {
  const out: unknown[] = []
  let text: string | null = null
  const flush = () => {
    if (text !== null) {
      const value = raw ? text : text.replace(/\s+/g, ' ').trim()
      if (value) out.push(['text', value])
      text = null
    }
  }
  for (const shape of shapes) {
    if (shape.t === 'text') {
      // Adjacent text nodes merge in the parser (e.g. after removing an inline element).
      text = (text ?? '') + shape.v
      continue
    }
    flush()
    if (shape.t === 'el') {
      const isRaw = raw || shape.raw === true
      out.push([shape.tag, shape.attrs, normalize(shape.children, isRaw)])
    } else {
      out.push([shape.t, shape.v])
    }
  }
  flush()
  return out
}

export function cloneShape<T extends Shape>(shape: T): T {
  return structuredClone(shape)
}

/** Finds an element shape by the NodeId it was built from, with its containing list. */
export function locate(
  roots: Shape[],
  id: string,
): { shape: ShapeElement; container: Shape[] } | null {
  for (const shape of roots) {
    if (shape.t !== 'el') continue
    if (shape.id === id) return { shape, container: roots }
    const found = locate(shape.children, id)
    if (found) return found
  }
  return null
}

/** NodeId (element index path) of a shape object inside a tree, by identity. */
export function pathOf(roots: Shape[], target: Shape, prefix = ''): string | null {
  let index = 0
  for (const shape of roots) {
    if (shape.t !== 'el') continue
    const id = prefix ? `${prefix}.${index}` : String(index)
    if (shape === target) return id
    const nested = pathOf(shape.children, target, id)
    if (nested) return nested
    index++
  }
  return null
}
