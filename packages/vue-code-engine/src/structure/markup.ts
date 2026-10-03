import type { EditValue, NodeSpec } from '@vuelume/project-model'
import { escapeAttributeValue, serializeJsLiteral } from '../literals.js'
import { camelize } from '../names.js'
import { isWritableAttributeName, RESERVED_ATTRIBUTES } from '../template.js'

export type { NodeSpec } from '@vuelume/project-model'

/** A literal value written into the template. */
export type SpecValue = EditValue

/** HTML elements that cannot have children or an end tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/** Elements whose content is raw text, so no element can be placed inside them. */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'textarea',
  'script',
  'style',
  'title',
])

const TAG = /^[A-Za-z][\w.-]*$/
const SLOT_NAME = /^[A-Za-z_][\w-]*$/

export function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag) || tag.includes('.')
}

/** Validates a spec; returns a human readable problem or `null`. */
export function specProblem(spec: NodeSpec): string | null {
  if (!TAG.test(spec.tag)) return `"${spec.tag}" is not a valid tag name.`
  if (['slot', 'component', 'script', 'style'].includes(spec.tag)) {
    return `<${spec.tag}> cannot be inserted from the editor.`
  }
  if (spec.tag === 'template') {
    if (!spec.slot || !SLOT_NAME.test(spec.slot)) return 'A <template> needs a valid slot name.'
  } else if (spec.slot !== undefined) {
    return '`slot` is only valid on <template>.'
  }
  for (const { name, value } of spec.attributes ?? []) {
    if (!isWritableAttributeName(name) || RESERVED_ATTRIBUTES.has(camelize(name))) {
      return `"${name}" is not an attribute the editor can write.`
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return `Invalid number for "${name}".`
  }
  if (spec.text !== undefined && VOID_ELEMENTS.has(spec.tag.toLowerCase())) {
    return `<${spec.tag}> cannot contain text.`
  }
  return null
}

export function renderAttribute(name: string, value: SpecValue): string {
  if (typeof value === 'string') return `${name}="${escapeAttributeValue(value, '"')}"`
  return `:${name}="${serializeJsLiteral(value, "'")}"`
}

/** `<div class="a">` — the opening tag only (for wrappers). */
export function renderOpenTag(spec: NodeSpec): string {
  const attributes = (spec.attributes ?? []).map((a) => ` ${renderAttribute(a.name, a.value)}`)
  const slot = spec.tag === 'template' && spec.slot ? ` #${spec.slot}` : ''
  return `<${spec.tag}${slot}${attributes.join('')}>`
}

/** Full markup of a new node, on a single line. */
export function renderSpec(spec: NodeSpec): string {
  const open = renderOpenTag(spec)
  if (VOID_ELEMENTS.has(spec.tag.toLowerCase())) return `${open.slice(0, -1)} />`
  const text = spec.text === undefined ? '' : escapeText(spec.text)
  if (!text && isComponentTag(spec.tag)) return `${open.slice(0, -1)} />`
  return `${open}${text}</${spec.tag}>`
}

/**
 * Escapes text content so it round-trips through the Vue parser: `<` and `&` (when it could
 * start a character reference) become references, and `{{` cannot start an interpolation.
 */
export function escapeText(text: string): string {
  return text
    .replace(/&(?=[a-zA-Z#])/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\{\{/g, '&#123;&#123;')
}
