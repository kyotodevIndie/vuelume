import type {
  NodeId,
  StructuralTarget,
  TemplateChildNode,
  TemplateElementNode,
} from '@vuelume/project-model'
import { analyzeComponent } from '../analyze.js'
import { isLoadError, loadDocument, type LoadedDocument } from '../document.js'
import { pascalize } from '../names.js'
import { detectEol } from '../positions.js'
import { applyTextEdits, type TextEdit } from '../transform/edits.js'
import type { TransformError, TransformErrorCode, TransformResult } from '../transform/props.js'
import { planImport, type ImportRequest } from './imports.js'
import {
  blockRange,
  detectIndentUnit,
  endsLine,
  eolLength,
  lineEnd,
  lineIndent,
  lineStart,
  reindent,
  startsLine,
} from './layout.js'
import {
  escapeText,
  RAW_TEXT_ELEMENTS,
  renderOpenTag,
  renderSpec,
  specProblem,
  VOID_ELEMENTS,
  type NodeSpec,
} from './markup.js'
import { buildShape, cloneShape, locate, pathOf, serializeShape, type Shape } from './shape.js'

export type { InsertPosition, StructuralTarget } from '@vuelume/project-model'

interface Base {
  /** Only used in messages and analysis; the engine never touches the file system. */
  filename?: string
}

export interface InsertNodeOptions extends Base {
  target: StructuralTarget
  node: NodeSpec
  /** Import to add to `<script setup>` when inserting a component that is not imported yet. */
  import?: ImportRequest
}

export interface RemoveNodeOptions extends Base {
  nodeId: NodeId
}

export interface MoveNodeOptions extends Base {
  nodeId: NodeId
  target: StructuralTarget
}

export interface WrapNodeOptions extends Base {
  nodeId: NodeId
  wrapper: NodeSpec
  import?: ImportRequest
}

export interface DuplicateNodeOptions extends Base {
  nodeId: NodeId
}

export interface SetTextOptions extends Base {
  nodeId: NodeId
  text: string
}

type Failure = { ok: false; error: TransformError }

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

/** Inserts a new element/component relative to `target`. */
export function insertNode(source: string, options: InsertNodeOptions): TransformResult {
  const problem = specProblem(options.node)
  if (problem) return fail('invalid-spec', problem)
  const ctx = open(source, options.filename)
  if (!(ctx instanceof Context)) return ctx

  const inserted = { slot: options.node.tag === 'template' ? (options.node.slot ?? null) : null }
  const invalid = validatePlacement(ctx, options.target, inserted)
  if (invalid) return invalid

  const importEdit = planImportEdit(ctx, options.node.tag, options.import)
  if (importEdit && 'ok' in importEdit) return importEdit

  const markup = renderSpec(options.node)
  const shape = shapeOfMarkup(markup)
  if (!shape) return fail('invalid-spec', `Could not render <${options.node.tag}>.`)

  const place = placement(ctx, options.target)
  if ('ok' in place) return place
  const edits: TextEdit[] = [
    { start: place.start, end: place.end, text: place.before + markup + place.after },
  ]
  if (importEdit) edits.push(importEdit)

  const expected = ctx.shape()
  insertShape(expected, options.target, shape)
  return finalize(ctx, edits, expected, shape, options.import)
}

/** Removes an element (with its whole line when it occupies whole lines). */
export function removeNode(source: string, options: RemoveNodeOptions): TransformResult {
  const ctx = open(source, options.filename)
  if (!(ctx instanceof Context)) return ctx
  const entry = ctx.entry(options.nodeId)
  if (!entry) return notFound(options.nodeId)
  const { element } = entry
  if (hasDirective(element, 'if') && hasElseFollower(entry)) {
    return fail(
      'conditional-chain',
      `<${element.tag}> starts a v-if/v-else chain; removing it would leave the v-else branch orphaned. Edit the chain in code.`,
    )
  }

  const block = removalRange(source, entry)
  const expected = ctx.shape()
  const found = locate(expected, element.id)!
  found.container.splice(found.container.indexOf(found.shape), 1)
  return finalize(ctx, [{ start: block.start, end: block.end, text: '' }], expected, null)
}

/**
 * Moves an element atomically: the removal and the insertion are computed on the same original
 * source, applied together and verified as one operation (never "remove, then insert").
 */
export function moveNode(source: string, options: MoveNodeOptions): TransformResult {
  const ctx = open(source, options.filename)
  if (!(ctx instanceof Context)) return ctx
  const entry = ctx.entry(options.nodeId)
  if (!entry) return notFound(options.nodeId)
  const { element } = entry

  if (isElseLike(element) || (hasDirective(element, 'if') && hasElseFollower(entry))) {
    return fail(
      'conditional-chain',
      `<${element.tag}> is part of a v-if/v-else chain; moving one branch would break it. Move the chain in code.`,
    )
  }
  const slot = slotNameOf(element)
  if (slot !== null) {
    const targetEntry = options.target.nodeId === null ? null : ctx.entry(options.target.nodeId)
    const sameParent =
      targetEntry &&
      (options.target.position === 'before' || options.target.position === 'after') &&
      targetEntry.parent?.id === entry.parent?.id
    if (!sameParent) {
      return fail(
        'invalid-target',
        'Slot templates can only be reordered inside their own component.',
      )
    }
  }
  const invalid = validatePlacement(ctx, options.target, { slot }, entry)
  if (invalid) return invalid

  const place = placement(ctx, options.target)
  if ('ok' in place) return place
  const start = element.range.start.offset
  const end = element.range.end.offset
  const block = removalRange(source, entry)
  if (place.end > block.start && place.start < block.end) {
    return fail('invalid-target', 'The element is already at that position.')
  }

  const content = source.slice(start, end)
  const moved =
    place.indent !== null && startsLine(source, start)
      ? reindent(content, lineIndent(source, start), place.indent, protectedRanges(element, start))
      : content
  const edits: TextEdit[] = [
    { start: block.start, end: block.end, text: '' },
    { start: place.start, end: place.end, text: place.before + moved + place.after },
  ]

  const expected = ctx.shape()
  const found = locate(expected, element.id)!
  found.container.splice(found.container.indexOf(found.shape), 1)
  insertShape(expected, options.target, found.shape)
  return finalize(ctx, edits, expected, found.shape)
}

/** Wraps an element in a new parent element/component. */
export function wrapNode(source: string, options: WrapNodeOptions): TransformResult {
  const problem = specProblem(options.wrapper)
  if (problem) return fail('invalid-spec', problem)
  const tag = options.wrapper.tag
  if (
    VOID_ELEMENTS.has(tag.toLowerCase()) ||
    RAW_TEXT_ELEMENTS.has(tag.toLowerCase()) ||
    tag === 'template'
  ) {
    return fail('invalid-spec', `<${tag}> cannot wrap other elements.`)
  }
  if (options.wrapper.text !== undefined) return fail('invalid-spec', 'A wrapper cannot have text.')
  const ctx = open(source, options.filename)
  if (!(ctx instanceof Context)) return ctx
  const entry = ctx.entry(options.nodeId)
  if (!entry) return notFound(options.nodeId)
  const { element } = entry

  if (isElseLike(element) || (hasDirective(element, 'if') && hasElseFollower(entry))) {
    return fail(
      'conditional-chain',
      'Elements in a v-if/v-else chain cannot be wrapped individually.',
    )
  }
  if (slotNameOf(element) !== null) {
    return fail('invalid-target', 'Slot templates must stay direct children of their component.')
  }
  const importEdit = planImportEdit(ctx, tag, options.import)
  if (importEdit && 'ok' in importEdit) return importEdit

  const open_ = renderOpenTag(options.wrapper)
  const close = `</${tag}>`
  const wrapperShape = shapeOfMarkup(open_ + close)
  if (!wrapperShape || wrapperShape.t !== 'el')
    return fail('invalid-spec', `Could not render <${tag}>.`)

  const start = element.range.start.offset
  const end = element.range.end.offset
  const content = source.slice(start, end)
  let edit: TextEdit
  if (startsLine(source, start) && endsLine(source, end)) {
    const outer = lineIndent(source, start)
    const inner = outer + ctx.unit
    const body = reindent(content, outer, inner, protectedRanges(element, start))
    edit = {
      start: lineStart(source, start),
      end,
      text: `${outer}${open_}${ctx.eol}${inner}${body}${ctx.eol}${outer}${close}`,
    }
  } else {
    edit = { start, end, text: open_ + content + close }
  }

  const expected = ctx.shape()
  const found = locate(expected, element.id)!
  wrapperShape.children = [found.shape]
  found.container.splice(found.container.indexOf(found.shape), 1, wrapperShape)
  return finalize(
    ctx,
    importEdit ? [edit, importEdit] : [edit],
    expected,
    wrapperShape,
    options.import,
  )
}

/** Inserts an exact copy of an element right after it. */
export function duplicateNode(source: string, options: DuplicateNodeOptions): TransformResult {
  const ctx = open(source, options.filename)
  if (!(ctx instanceof Context)) return ctx
  const entry = ctx.entry(options.nodeId)
  if (!entry) return notFound(options.nodeId)
  const { element } = entry
  if (hasDirective(element, 'else') || (hasDirective(element, 'if') && hasElseFollower(entry))) {
    return fail(
      'conditional-chain',
      'Duplicating one branch would change the v-if/v-else chain. Edit it in code.',
    )
  }
  if (slotNameOf(element) !== null) {
    return fail('invalid-target', 'A slot can only be provided once per component.')
  }

  const start = element.range.start.offset
  const end = element.range.end.offset
  let edit: TextEdit
  if (startsLine(source, start) && endsLine(source, end)) {
    const terminator = lineEnd(source, end)
    edit = {
      start: terminator,
      end: terminator,
      text: ctx.eol + source.slice(lineStart(source, start), terminator),
    }
  } else {
    edit = { start: end, end, text: source.slice(start, end) }
  }

  const expected = ctx.shape()
  const found = locate(expected, element.id)!
  const copy = cloneShape(found.shape)
  found.container.splice(found.container.indexOf(found.shape) + 1, 0, copy)
  return finalize(ctx, [edit], expected, copy)
}

/** Replaces the static text content of an element that contains only text. */
export function setText(source: string, options: SetTextOptions): TransformResult {
  const ctx = open(source, options.filename)
  if (!(ctx instanceof Context)) return ctx
  const entry = ctx.entry(options.nodeId)
  if (!entry) return notFound(options.nodeId)
  const { element } = entry
  const tag = element.tag.toLowerCase()
  if (VOID_ELEMENTS.has(tag) || tag === 'script' || tag === 'style') {
    return fail('invalid-target', `<${element.tag}> cannot contain text.`)
  }
  if (hasDirective(element, 'html') || hasDirective(element, 'text')) {
    return fail(
      'dynamic-content',
      `The content of <${element.tag}> comes from v-html/v-text. Edit it in code.`,
    )
  }
  if (element.children.some((c) => c.type !== 'text')) {
    return fail(
      'dynamic-content',
      `<${element.tag}> contains elements, {{ }} interpolations or comments; only plain text can be edited visually.`,
    )
  }

  const escaped = escapeText(options.text)
  const raw = tag === 'pre' || tag === 'textarea'
  let edit: TextEdit
  if (element.selfClosing) {
    if (!options.text) return { ok: true, code: source, changed: false, edits: [] }
    const cut = selfClosingCut(source, element)
    edit = { start: cut, end: element.range.end.offset, text: `>${escaped}</${element.tag}>` }
  } else {
    const close = closeTagStart(source, element)
    if (close === null)
      return fail('invalid-target', `Could not find the end tag of <${element.tag}>.`)
    const inner = element.startTagRange.end.offset
    const current = source.slice(inner, close)
    const keep = !raw && current.trim() !== '' && options.text !== ''
    const lead = keep ? /^\s*/.exec(current)![0] : ''
    const trail = keep ? /\s*$/.exec(current)![0] : ''
    edit = { start: inner, end: close, text: lead + escaped + trail }
  }

  const expected = ctx.shape()
  const found = locate(expected, element.id)!
  found.shape.children = options.text ? [{ t: 'text', v: options.text }] : []
  return finalize(ctx, [edit], expected, found.shape)
}

// ---------------------------------------------------------------------------
// Context, validation, placement
// ---------------------------------------------------------------------------

interface Entry {
  element: TemplateElementNode
  parent: TemplateElementNode | null
  siblings: TemplateChildNode[]
}

class Context {
  readonly eol: '\n' | '\r\n'
  readonly unit: string
  readonly #index = new Map<string, Entry>()

  constructor(readonly doc: LoadedDocument) {
    this.eol = detectEol(doc.source)
    this.unit = detectIndentUnit(doc.source, doc.template)
    const visit = (siblings: TemplateChildNode[], parent: TemplateElementNode | null) => {
      for (const node of siblings) {
        if (node.type !== 'element') continue
        this.#index.set(node.id, { element: node, parent, siblings })
        visit(node.children, node)
      }
    }
    visit(doc.template.children, null)
  }

  get source(): string {
    return this.doc.source
  }

  entry(id: NodeId): Entry | undefined {
    return this.#index.get(id)
  }

  /** Fresh shape tree of the original template (each call returns a new copy). */
  shape(): Shape[] {
    return buildShape(this.doc.template.children)
  }
}

function open(source: string, filename = 'anonymous.vue'): Context | Failure {
  const doc = loadDocument(source, filename)
  if (isLoadError(doc)) return fail(doc.code, doc.message)
  return new Context(doc)
}

interface Inserted {
  /** Slot name when the node is a `<template #slot>`. */
  slot: string | null
}

function validatePlacement(
  ctx: Context,
  target: StructuralTarget,
  inserted: Inserted,
  moving?: Entry,
): Failure | null {
  if (target.nodeId === null) {
    if (target.position === 'before' || target.position === 'after') {
      return fail('invalid-target', 'The template root has no siblings.')
    }
    if (inserted.slot !== null)
      return fail('invalid-target', 'Slot templates must be inside a component.')
    return null
  }
  const entry = ctx.entry(target.nodeId)
  if (!entry) return notFound(target.nodeId)
  const el = entry.element

  if (moving) {
    const id = moving.element.id
    if (el.id === id || el.id.startsWith(`${id}.`)) {
      return fail('invalid-target', 'An element cannot be moved into itself.')
    }
  }

  // Inside inline <svg>, HTML elements are parsed as foreign content: only SVG content may be
  // rearranged there, and nothing new is inserted from the (HTML) palette.
  const container = target.position === 'before' || target.position === 'after' ? entry.parent : el
  if (inSvg(ctx, container) && !(moving && inSvg(ctx, moving.parent))) {
    return fail('invalid-target', 'Only SVG elements can be placed inside an inline <svg>.')
  }

  if (target.position === 'before' || target.position === 'after') {
    if (target.position === 'before' && isElseLike(el)) {
      return fail(
        'conditional-chain',
        'Nothing can be placed between v-if/v-else-if/v-else branches.',
      )
    }
    if (target.position === 'after' && hasElseFollower(entry)) {
      return fail(
        'conditional-chain',
        'Nothing can be placed between v-if/v-else-if/v-else branches.',
      )
    }
    if (!entry.parent) {
      return inserted.slot !== null
        ? fail('invalid-target', 'Slot templates must be inside a component.')
        : null
    }
    return validateContainer(entry.parent, inserted, moving)
  }
  return validateContainer(el, inserted, moving)
}

function validateContainer(
  el: TemplateElementNode,
  inserted: Inserted,
  moving?: Entry,
): Failure | null {
  const tag = el.tag.toLowerCase()
  if (VOID_ELEMENTS.has(tag)) return fail('invalid-target', `<${el.tag}> cannot have children.`)
  if (RAW_TEXT_ELEMENTS.has(tag))
    return fail('invalid-target', `<${el.tag}> can only contain text.`)
  if (hasDirective(el, 'html') || hasDirective(el, 'text')) {
    return fail('invalid-target', `The content of <${el.tag}> is replaced by v-html/v-text.`)
  }
  const slotTemplates = el.children.filter(
    (c): c is TemplateElementNode => c.type === 'element' && slotNameOf(c) !== null,
  )
  if (inserted.slot !== null) {
    if (el.elementType !== 'component') {
      return fail('invalid-target', 'Slot templates can only be placed inside a component.')
    }
    const duplicate = slotTemplates.some(
      (t) => slotNameOf(t) === inserted.slot && t.id !== moving?.element.id,
    )
    if (duplicate)
      return fail('invalid-target', `<${el.tag}> already provides the "${inserted.slot}" slot.`)
    return null
  }
  if (el.elementType === 'component' && slotTemplates.some((t) => slotNameOf(t) === 'default')) {
    return fail(
      'invalid-target',
      `<${el.tag}> has an explicit #default template; place the element inside that template.`,
    )
  }
  return null
}

interface Placement {
  start: number
  end: number
  /** Indentation used for a block placement, or `null` for inline placement. */
  indent: string | null
  before: string
  after: string
}

/** Computes where (and with which surrounding whitespace) new content goes. */
function placement(ctx: Context, target: StructuralTarget): Placement | Failure {
  const s = ctx.source
  const eol = ctx.eol
  const inline = (at: number): Placement => ({
    start: at,
    end: at,
    indent: null,
    before: '',
    after: '',
  })
  const line = (at: number, indent: string): Placement => ({
    start: at,
    end: at,
    indent,
    before: indent,
    after: eol,
  })

  if (target.nodeId === null) {
    const start = ctx.doc.template.range.start.offset
    const end = ctx.doc.template.range.end.offset
    const indent = firstLineIndent(s, ctx.doc.template.children) ?? ctx.unit
    const firstNonWs = s.slice(start, end).search(/\S/)
    if (target.position === 'first-child' && firstNonWs >= 0) {
      const at = start + firstNonWs
      return s.slice(start, at).includes('\n') ? line(lineStart(s, at), indent) : inline(start)
    }
    if (startsLine(s, end) && s.slice(start, end).includes('\n'))
      return line(lineStart(s, end), indent)
    return inline(end)
  }

  const { element, parent } = ctx.entry(target.nodeId)!
  const start = element.range.start.offset
  const end = element.range.end.offset

  // Whitespace is content inside <pre>/<textarea>: never add indentation or line breaks there.
  const container = target.position === 'before' || target.position === 'after' ? parent : element
  if (inRawText(ctx, container)) {
    if (target.position === 'before') return inline(start)
    if (target.position === 'after') return inline(end)
  }

  // Siblings separated by blank lines keep that rhythm around the new node.
  const entry = ctx.entry(target.nodeId)!
  if (target.position === 'before') {
    if (!startsLine(s, start)) return inline(start)
    const spaced = blankSeparated(s, entry)
    return { ...line(lineStart(s, start), lineIndent(s, start)), after: spaced ? eol + eol : eol }
  }
  if (target.position === 'after') {
    if (!endsLine(s, end)) return inline(end)
    const indent = lineIndent(s, start)
    const terminator = lineEnd(s, end)
    const before = (blankSeparated(s, entry) ? eol + eol : eol) + indent
    return { start: terminator, end: terminator, indent, before, after: '' }
  }

  const childIndent = firstLineIndent(s, element.children) ?? lineIndent(s, start) + ctx.unit
  const standalone = startsLine(s, start)

  if (element.selfClosing) {
    const cut = selfClosingCut(s, element)
    const close = `</${element.tag}>`
    if (inRawText(ctx, element)) return { start: cut, end, indent: null, before: '>', after: close }
    return standalone
      ? {
          start: cut,
          end,
          indent: childIndent,
          before: `>${eol}${childIndent}`,
          after: `${eol}${lineIndent(s, start)}${close}`,
        }
      : { start: cut, end, indent: null, before: '>', after: close }
  }

  const close = closeTagStart(s, element)
  if (close === null)
    return fail('invalid-target', `Could not find the end tag of <${element.tag}>.`)
  const inner = element.startTagRange.end.offset
  if (inRawText(ctx, element)) return inline(target.position === 'first-child' ? inner : close)
  const content = s.slice(inner, close)
  const firstNonWs = content.search(/\S/)

  if (firstNonWs < 0) {
    if (content.includes('\n') && startsLine(s, close))
      return line(lineStart(s, close), childIndent)
    if (standalone && endsLine(s, end)) {
      return {
        start: inner,
        end: close,
        indent: childIndent,
        before: `${eol}${childIndent}`,
        after: `${eol}${lineIndent(s, start)}`,
      }
    }
    return inline(inner)
  }
  if (target.position === 'first-child') {
    const at = inner + firstNonWs
    return content.slice(0, firstNonWs).includes('\n')
      ? line(lineStart(s, at), childIndent)
      : inline(inner)
  }
  return content.includes('\n') && startsLine(s, close)
    ? line(lineStart(s, close), childIndent)
    : inline(close)
}

/** `true` when the line containing `offset` holds only whitespace. */
function isBlankLine(source: string, offset: number): boolean {
  return source.slice(lineStart(source, offset), lineEnd(source, offset)).trim() === ''
}

/** Whether an element is separated from an adjacent sibling element by a blank line. */
function blankSeparated(source: string, entry: Entry): boolean {
  const start = lineStart(source, entry.element.range.start.offset)
  const terminator = lineEnd(source, entry.element.range.end.offset)
  const next = terminator + eolLength(source, terminator)
  return (
    (previousElementSibling(entry) !== null && start > 0 && isBlankLine(source, start - 1)) ||
    (nextElementSibling(entry) !== null && next < source.length && isBlankLine(source, next))
  )
}

/**
 * The block to delete for an element. With siblings separated by blank lines, one adjacent
 * blank line goes too, so neither a double blank line nor a dangling one is left behind.
 */
function removalRange(source: string, entry: Entry): { start: number; end: number } {
  const { start, end } = entry.element.range
  const block = blockRange(source, start.offset, end.offset)
  if (!block.standalone || block.start === 0 || block.end >= source.length) return block
  const blankBefore = isBlankLine(source, block.start - 1)
  const blankAfter = isBlankLine(source, block.end)
  if (blankAfter && (blankBefore || previousElementSibling(entry) === null)) {
    const terminator = lineEnd(source, block.end)
    return { start: block.start, end: terminator + eolLength(source, terminator) }
  }
  if (blankBefore && nextElementSibling(entry) === null) {
    return { start: lineStart(source, block.start - 1), end: block.end }
  }
  return block
}

function nextElementSibling(entry: Entry): TemplateElementNode | null {
  const index = entry.siblings.indexOf(entry.element)
  for (const node of entry.siblings.slice(index + 1)) if (node.type === 'element') return node
  return null
}

function previousElementSibling(entry: Entry): TemplateElementNode | null {
  const index = entry.siblings.indexOf(entry.element)
  for (let i = index - 1; i >= 0; i--) {
    const node = entry.siblings[i]!
    if (node.type === 'element') return node
  }
  return null
}

/** Indentation of the first child element that starts its own line. */
function firstLineIndent(source: string, children: TemplateChildNode[]): string | null {
  for (const child of children) {
    if (child.type === 'element' && startsLine(source, child.range.start.offset)) {
      return lineIndent(source, child.range.start.offset)
    }
  }
  return null
}

/** Offset of `</tag>` of an element, or `null` when it has no explicit end tag. */
function closeTagStart(source: string, element: TemplateElementNode): number | null {
  const end = element.range.end.offset
  const at = source.lastIndexOf('</', end - 1)
  if (at < element.startTagRange.end.offset) return null
  const tag = element.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^</${tag}\\s*>$`, 'i').test(source.slice(at, end)) ? at : null
}

/**
 * Offset where `/>` starts in a self-closing tag, including spaces before it on the same line
 * (`<A title="x" />` → `<A title="x">`). When `/>` sits on its own line it stays there as `>`.
 */
function selfClosingCut(source: string, element: TemplateElementNode): number {
  let at = element.range.end.offset - 2
  while (at > 0 && (source[at - 1] === ' ' || source[at - 1] === '\t')) at--
  return source[at - 1] === '\n' ? element.range.end.offset - 2 : at
}

function insertShape(roots: Shape[], target: StructuralTarget, shape: Shape): void {
  if (target.nodeId === null) {
    if (target.position === 'first-child') roots.unshift(shape)
    else roots.push(shape)
    return
  }
  const found = locate(roots, target.nodeId)!
  const index = found.container.indexOf(found.shape)
  if (target.position === 'before') found.container.splice(index, 0, shape)
  else if (target.position === 'after') found.container.splice(index + 1, 0, shape)
  else if (target.position === 'first-child') found.shape.children.unshift(shape)
  else found.shape.children.push(shape)
}

function shapeOfMarkup(markup: string): Shape | null {
  const doc = loadDocument(`<template>${markup}</template>`, 'markup.vue')
  if (isLoadError(doc) || doc.template.children.length !== 1) return null
  const [shape] = buildShape(doc.template.children)
  if (shape?.t === 'el') delete shape.id
  return shape ?? null
}

function planImportEdit(
  ctx: Context,
  tag: string,
  request: ImportRequest | undefined,
): TextEdit | Failure | null {
  if (!request) return null
  if (pascalize(tag) !== pascalize(request.local)) {
    return fail('invalid-spec', `<${tag}> does not match the imported name "${request.local}".`)
  }
  const plan = planImport(ctx.source, ctx.doc.descriptor, request)
  if (!plan.ok) return fail(plan.code, plan.message)
  return plan.edit
}

function protectedRanges(element: TemplateElementNode, base: number): [number, number][] {
  const ranges: [number, number][] = []
  const visit = (node: TemplateChildNode) => {
    if (node.type === 'element') {
      for (const attr of node.attributes) {
        ranges.push([attr.range.start.offset - base, attr.range.end.offset - base])
      }
      if (node.tag === 'pre' || node.tag === 'textarea') {
        ranges.push([node.range.start.offset - base, node.range.end.offset - base])
      }
      node.children.forEach(visit)
    } else if (node.type === 'interpolation') {
      ranges.push([node.range.start.offset - base, node.range.end.offset - base])
    }
  }
  visit(element)
  return ranges
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Applies the edits and accepts the result only if:
 * - every template edit stays inside the template and the result parses without errors;
 * - the re-parsed template has exactly the expected shape (the operation applied to the
 *   original shape) — so no content is lost, duplicated or misplaced;
 * - other blocks (`<style>`, custom blocks, scripts) are unchanged, except for the requested
 *   import, which must now be present.
 */
function finalize(
  ctx: Context,
  edits: TextEdit[],
  expected: Shape[],
  focus: Shape | null,
  importRequest?: ImportRequest,
): TransformResult {
  const { source, template, descriptor, filename } = ctx.doc
  const templateStart = template.range.start.offset
  const templateEnd = template.range.end.offset
  const importEdits = importRequest ? edits.slice(1) : []
  for (const edit of edits.slice(0, edits.length - importEdits.length)) {
    if (edit.start < templateStart || edit.end > templateEnd) {
      return verificationFailed('an edit escapes the template')
    }
  }

  const code = applyTextEdits(source, edits)
  const reloaded = loadDocument(code, filename)
  if (isLoadError(reloaded))
    return verificationFailed(`the result does not parse (${reloaded.message})`)

  if (serializeShape(buildShape(reloaded.template.children)) !== serializeShape(expected)) {
    return verificationFailed('the resulting template does not match the requested operation')
  }

  const after = reloaded.descriptor
  const sameBlocks =
    after.styles.length === descriptor.styles.length &&
    after.styles.every((s, i) => s.content === descriptor.styles[i]!.content) &&
    after.customBlocks.every((b, i) => b.content === descriptor.customBlocks[i]?.content)
  if (!sameBlocks) return verificationFailed('another block of the file changed')

  if (importEdits.length > 0 && importRequest) {
    const model = analyzeComponent(code, { filename })
    if (model.diagnostics.some((d) => d.code === 'script/parse-error')) {
      return verificationFailed('the script does not parse after adding the import')
    }
    const imported = model.imports.some(
      (i) =>
        i.source === importRequest.source &&
        i.specifiers.some((s) => s.kind === 'default' && s.local === importRequest.local),
    )
    if (!imported) return verificationFailed('the import was not added')
  } else if (
    after.scriptSetup?.content !== descriptor.scriptSetup?.content ||
    after.script?.content !== descriptor.script?.content
  ) {
    return verificationFailed('the script changed unexpectedly')
  }

  const nodeId = focus ? pathOf(expected, focus) : null
  return { ok: true, code, changed: code !== source, edits, ...(nodeId ? { nodeId } : {}) }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Whether content placed in `container` ends up in SVG (not HTML) parsing context. */
function inRawText(ctx: Context, container: TemplateElementNode | null): boolean {
  for (let el = container; el; el = ctx.entry(el.id)?.parent ?? null) {
    const tag = el.tag.toLowerCase()
    if (tag === 'pre' || tag === 'textarea') return true
  }
  return false
}

function inSvg(ctx: Context, container: TemplateElementNode | null): boolean {
  for (let el = container; el; el = ctx.entry(el.id)?.parent ?? null) {
    const tag = el.tag.toLowerCase()
    if (tag === 'foreignobject') return false
    if (tag === 'svg') return true
  }
  return false
}

function hasDirective(el: TemplateElementNode, name: string): boolean {
  return el.attributes.some((a) => a.kind === 'directive' && a.name === name)
}

function isElseLike(el: TemplateElementNode): boolean {
  return hasDirective(el, 'else') || hasDirective(el, 'else-if')
}

/** The next element sibling, as Vue sees it for v-if chains (comments are skipped, text breaks). */
function nextChainSibling(entry: Entry): TemplateElementNode | null {
  const index = entry.siblings.indexOf(entry.element)
  for (const node of entry.siblings.slice(index + 1)) {
    if (node.type === 'comment') continue
    return node.type === 'element' ? node : null
  }
  return null
}

function hasElseFollower(entry: Entry): boolean {
  const next = nextChainSibling(entry)
  return next !== null && isElseLike(next)
}

/** Slot name of a `<template #name>` / `<template v-slot:name>`, or `null`. */
function slotNameOf(el: TemplateElementNode): string | null {
  if (el.elementType !== 'template') return null
  const slot = el.attributes.find((a) => a.kind === 'directive' && a.name === 'slot')
  if (!slot || slot.kind !== 'directive') return null
  return slot.arg ?? 'default'
}

function fail(code: TransformErrorCode, message: string): Failure {
  return { ok: false, error: { code, message } }
}

function notFound(id: NodeId): Failure {
  return fail('node-not-found', `No element with id "${id}".`)
}

function verificationFailed(detail: string): Failure {
  return fail('verification-failed', `Operation rejected: ${detail}. The file was not changed.`)
}
