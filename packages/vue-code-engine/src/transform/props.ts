import { parse } from '@vue/compiler-sfc'
import type {
  LiteralValue,
  NodeId,
  ReadonlyReason,
  TemplateAttribute,
  TemplateElementNode,
  TemplateModel,
} from '@vuelume/project-model'
import { findElementById, walkElements } from '@vuelume/project-model'
import { escapeAttributeValue, serializeJsLiteral } from '../literals.js'
import { camelize } from '../names.js'
import { detectEol, LineIndex } from '../positions.js'
import { buildTemplateModel, propKey, RESERVED_ATTRIBUTES } from '../template.js'
import { applyTextEdits, type TextEdit } from './edits.js'

/** Values the Inspector can write in this phase. Anything else stays "Open in code". */
export type PropValue = string | number | boolean

export type TransformErrorCode =
  /** The file (or the result) does not parse cleanly — we never edit broken files. */
  | 'parse-error'
  | 'no-template'
  | 'node-not-found'
  /** The node/attribute is outside the safe subset; see `reason`. */
  | 'readonly'
  | 'invalid-name'
  | 'invalid-value'
  /** The edit was computed but re-parsing showed it did not do exactly what was asked. */
  | 'verification-failed'

export interface TransformError {
  code: TransformErrorCode
  message: string
  reason?: ReadonlyReason
}

export type TransformResult =
  | {
      ok: true
      /** New file content (identical to the input when `changed` is false). */
      code: string
      changed: boolean
      edits: TextEdit[]
    }
  | { ok: false; error: TransformError }

export interface PropTarget {
  /** Only used in messages; the engine never touches the file system. */
  filename?: string
  nodeId: NodeId
  /** Prop name, camelCase or kebab-case (`isActive` and `is-active` match the same attribute). */
  name: string
}

export interface SetPropOptions extends PropTarget {
  value: PropValue
}

const VALID_NAME = /^[A-Za-z_][\w-]*$/
/** Characters allowed in an unquoted HTML attribute value (plus no `&`, to avoid references). */
const UNQUOTED_SAFE = /^[^\s"'=<>`&]+$/

/**
 * Sets a prop on a template element with a minimal edit.
 *
 * Preserves the author's style: an existing static attribute stays static, an existing
 * `:prop="literal"` binding stays a binding, quotes are kept, new attributes follow the
 * element's layout (same line or one-per-line with matching indentation).
 * Refuses (instead of guessing) whenever the element/attribute is outside the safe subset.
 */
export function setProp(source: string, options: SetPropOptions): TransformResult {
  const { name, value } = options
  const nameError = validateName(name)
  if (nameError) return nameError
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return fail('invalid-value', `Cannot write non-finite number ${value}.`)
  }

  const loaded = loadElement(source, options)
  if (!loaded.ok) return loaded
  const { element } = loaded

  const matches = element.attributes.filter((a) => propKey(a) === camelize(name))
  if (matches.length > 1) {
    return readonly('duplicate', `"${name}" is written more than once on <${element.tag}>.`)
  }
  const existing = matches[0]

  let edit: TextEdit | null
  if (existing) {
    if (!existing.editable) {
      return readonly(
        existing.readonlyReason ?? 'advanced-binding',
        `"${name}" on <${element.tag}> cannot be edited visually (${existing.readonlyReason}).`,
      )
    }
    edit = rewriteAttribute(source, existing, value)
  } else {
    const blocker = elementBlocker(element, name)
    if (blocker) return blocker
    edit = insertAttribute(source, element, renderAttribute(name, value))
  }

  if (!edit) return { ok: true, code: source, changed: false, edits: [] }
  return verify(source, [edit], element, options, (after) => {
    const found = after.attributes.filter((a) => propKey(a) === camelize(name))
    return found.length === 1 && attributeHasValue(found[0]!, value)
  })
}

/**
 * Removes a prop attribute (static or bound) together with the whitespace separating it
 * from the previous token, so "one attribute per line" layouts stay tidy.
 * Removing an absent prop is a successful no-op.
 */
export function removeProp(source: string, options: PropTarget): TransformResult {
  const nameError = validateName(options.name)
  if (nameError) return nameError
  const loaded = loadElement(source, options)
  if (!loaded.ok) return loaded
  const { element } = loaded

  const key = camelize(options.name)
  const matches = element.attributes.filter((a) => propKey(a) === key)
  if (matches.length === 0) return { ok: true, code: source, changed: false, edits: [] }
  if (matches.length > 1) {
    return readonly('duplicate', `"${options.name}" is written more than once on <${element.tag}>.`)
  }

  const edit = removalEdit(source, matches[0]!)
  return verify(source, [edit], element, options, (after) =>
    after.attributes.every((a) => propKey(a) !== key),
  )
}

/**
 * - `<A
  title="x"
  b
/>` → removes the line (`
  title="x"`)
 * - `<A title="x" b />`       → removes ` title="x"`
 * - `<A
  title="x" b
/>`   → removes `title="x" ` (keeps `b` on its indented line)
 */
function removalEdit(source: string, attr: TemplateAttribute): TextEdit {
  const start = attr.range.start.offset
  const end = attr.range.end.offset
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  const startsLine = /^[ \t]*$/.test(source.slice(lineStart, start))
  let next = end
  while (source[next] === ' ' || source[next] === '\t') next++
  const followedOnSameLine = next < source.length && !'\r\n/>'.includes(source[next]!)
  if (startsLine && followedOnSameLine) return { start, end: next, text: '' }

  let from = start
  while (from > 0 && /\s/.test(source[from - 1]!)) from--
  return { start: from, end, text: '' }
}

// ---------------------------------------------------------------------------

type Loaded = { ok: true; element: TemplateElementNode } | { ok: false; error: TransformError }

function loadTemplate(source: string, filename: string): TemplateModel | TransformError {
  const { descriptor, errors } = parse(source, { filename, sourceMap: false })
  if (errors.length > 0) {
    return {
      code: 'parse-error',
      message: `Refusing to edit a file with parse errors: ${errors[0]!.message}`,
    }
  }
  const { template } = buildTemplateModel(descriptor.template, filename, new LineIndex(source))
  return template ?? { code: 'no-template', message: 'The file has no analyzable template.' }
}

function loadElement(source: string, target: PropTarget): Loaded {
  const template = loadTemplate(source, target.filename ?? 'anonymous.vue')
  if ('code' in template) return { ok: false, error: template }
  const element = findElementById(template, target.nodeId)
  if (!element) {
    return fail('node-not-found', `No element with id "${target.nodeId}".`)
  }
  if (element.elementType === 'template') {
    return fail('readonly', '<template> wrappers have no props.', 'directive')
  }
  return { ok: true, element }
}

function validateName(name: string): { ok: false; error: TransformError } | null {
  if (!VALID_NAME.test(name) || name.startsWith('v-')) {
    return fail('invalid-name', `"${name}" is not a plain prop name.`)
  }
  if (RESERVED_ATTRIBUTES.has(camelize(name))) {
    return fail('invalid-name', `"${name}" is a reserved attribute and is not editable as a prop.`)
  }
  return null
}

/** Element-level rules that block ADDING a prop. */
function elementBlocker(
  element: TemplateElementNode,
  name: string,
): { ok: false; error: TransformError } | null {
  if (element.flags.includes('spread-binding')) {
    return readonly(
      'spread-binding',
      `<${element.tag}> uses v-bind="…"; an explicit prop could be overridden. Edit it in code.`,
    )
  }
  const key = camelize(name)
  const modeled = element.attributes.some(
    (a) => a.kind === 'directive' && a.name === 'model' && camelize(a.arg ?? 'modelValue') === key,
  )
  if (modeled) return readonly('model-binding', `"${name}" is controlled by v-model.`)
  return null
}

function rewriteAttribute(
  source: string,
  attr: TemplateAttribute,
  value: PropValue,
): TextEdit | null {
  if (attributeHasValue(attr, value)) return null

  if (attr.kind === 'static') {
    if (typeof value === 'string') {
      const quote = pickQuote(attr.quote ?? '"', value)
      // Keep the author's unquoted style (`id=app`) when the new value allows it.
      const text =
        attr.valueRange && attr.quote === null && UNQUOTED_SAFE.test(value)
          ? value
          : quote + escapeAttributeValue(value, quote) + quote
      return attr.valueRange
        ? { start: attr.valueRange.start.offset, end: attr.valueRange.end.offset, text }
        : { start: attr.range.end.offset, end: attr.range.end.offset, text: `=${text}` }
    }
    // A number/boolean needs a binding: `featured="x"` → `:featured="true"`.
    return {
      start: attr.range.start.offset,
      end: attr.range.end.offset,
      text: `:${attr.name}="${serializeJsLiteral(value, "'")}"`,
    }
  }

  if (attr.kind === 'bind' && attr.expressionRange && attr.literal) {
    const start = attr.expressionRange.start.offset
    const end = attr.expressionRange.end.offset
    const before = source[start - 1]
    const outer: '"' | "'" | null = before === '"' || before === "'" ? before : null
    const attrQuote = outer ?? '"'
    const inner = innerQuote(source.slice(start, end), attrQuote)
    const literal = escapeAttributeValue(serializeJsLiteral(value, inner), attrQuote)
    return { start, end, text: outer ? literal : `"${literal}"` }
  }
  return null
}

/** Quote for a string literal inside an attribute: keep the author's, never the attribute's. */
function innerQuote(existingExpression: string, attrQuote: '"' | "'"): '"' | "'" {
  const first = existingExpression.trimStart()[0]
  if ((first === '"' || first === "'") && first !== attrQuote) return first
  return attrQuote === '"' ? "'" : '"'
}

function pickQuote(preferred: '"' | "'", value: string): '"' | "'" {
  if (!value.includes(preferred)) return preferred
  const other = preferred === '"' ? "'" : '"'
  return value.includes(other) ? preferred : other
}

function renderAttribute(name: string, value: PropValue): string {
  if (typeof value === 'string') return `${name}="${escapeAttributeValue(value, '"')}"`
  return `:${name}="${serializeJsLiteral(value, "'")}"`
}

/**
 * Inserts a new attribute after the last one, following the element's layout:
 * if the last attribute sits on its own line, the new one goes on a new line with the
 * same indentation; otherwise it is appended on the same line.
 */
function insertAttribute(source: string, element: TemplateElementNode, text: string): TextEdit {
  const last = element.attributes.at(-1)
  if (!last) {
    const at = element.range.start.offset + 1 + element.tag.length
    return { start: at, end: at, text: ` ${text}` }
  }
  const at = last.range.end.offset
  const lineStart = source.lastIndexOf('\n', last.range.start.offset - 1) + 1
  const indent = source.slice(lineStart, last.range.start.offset)
  if (/^[ \t]*$/.test(indent)) {
    return { start: at, end: at, text: `${detectEol(source)}${indent}${text}` }
  }
  return { start: at, end: at, text: ` ${text}` }
}

function attributeHasValue(attr: TemplateAttribute, value: PropValue): boolean {
  if (attr.kind === 'static') {
    if (typeof value === 'string') return attr.value === value
    // A valueless attribute is `true` for boolean props.
    return value === true && attr.value === null
  }
  if (attr.kind === 'bind') return literalEquals(attr.literal, value)
  return false
}

function literalEquals(literal: LiteralValue | null, value: PropValue): boolean {
  if (!literal || literal.type === 'null' || literal.type === 'undefined') return false
  return literal.type === typeof value && Object.is(literal.value, value)
}

/**
 * Safety net for every transformation: apply the edits, re-parse the result and check that
 * - the file still parses without errors,
 * - nothing outside the element's start tag changed,
 * - the same element (same id and tag) is still there with the same subtree shape,
 * - every attribute we did not target is byte-for-byte identical and in the same order,
 * - the targeted prop now has exactly the requested state.
 * If any check fails, the transformation is rejected and the source is left untouched.
 */
function verify(
  source: string,
  edits: TextEdit[],
  before: TemplateElementNode,
  target: PropTarget,
  expectation: (after: TemplateElementNode) => boolean,
): TransformResult {
  const tagStart = before.startTagRange.start.offset
  const tagEnd = before.startTagRange.end.offset
  if (edits.some((e) => e.start < tagStart || e.end > tagEnd)) {
    return verificationFailed('edit escapes the element start tag')
  }

  const code = applyTextEdits(source, edits)
  const delta = code.length - source.length
  if (
    code.slice(0, tagStart) !== source.slice(0, tagStart) ||
    code.slice(tagEnd + delta) !== source.slice(tagEnd)
  ) {
    return verificationFailed('content outside the start tag changed')
  }

  const template = loadTemplate(code, target.filename ?? 'anonymous.vue')
  if ('code' in template) return verificationFailed(`result does not parse (${template.message})`)
  const after = findElementById(template, target.nodeId)
  if (!after || after.tag !== before.tag) return verificationFailed('element identity changed')
  if (countElements(after) !== countElements(before)) {
    return verificationFailed('element subtree changed')
  }

  const key = camelize(target.name)
  const untouched = (el: TemplateElementNode, text: string) =>
    el.attributes
      .filter((a) => propKey(a) !== key)
      .map((a) => text.slice(a.range.start.offset, a.range.end.offset))
  if (untouched(before, source).join('\0') !== untouched(after, code).join('\0')) {
    return verificationFailed('other attributes changed')
  }
  if (!expectation(after)) return verificationFailed('prop does not have the requested value')

  return { ok: true, code, changed: code !== source, edits }
}

function countElements(element: TemplateElementNode): number {
  let count = 0
  for (const _ of walkElements(element)) count++
  return count
}

function fail(
  code: TransformErrorCode,
  message: string,
  reason?: ReadonlyReason,
): { ok: false; error: TransformError } {
  return { ok: false, error: { code, message, ...(reason ? { reason } : {}) } }
}

function readonly(reason: ReadonlyReason, message: string): { ok: false; error: TransformError } {
  return fail('readonly', message, reason)
}

function verificationFailed(detail: string): { ok: false; error: TransformError } {
  return fail('verification-failed', `Transformation rejected: ${detail}.`)
}
