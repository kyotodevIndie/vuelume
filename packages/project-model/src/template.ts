import type { SourceRange } from './source.js'

/**
 * Identifier of a template node, unique within one component file.
 *
 * It is the path of element indices from the template root, joined by `.`
 * (e.g. `"0.2.1"` = second element child of the third element child of the first root element).
 * Only element nodes are counted, so editing text, comments or attributes never changes ids.
 * Structural edits (insert/remove/move) DO change ids — see ARCHITECTURE.md "Node identity".
 */
export type NodeId = string

/** Globally unique reference to a template node: which file + which node. */
export interface NodeRef {
  file: string
  nodeId: NodeId
}

/** The value of a literal expression that the tool can read and write safely. */
export type LiteralValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'undefined' }

/**
 * Why an attribute cannot be edited visually. The UI shows these as
 * "⚠ Advanced binding — Open in code" style hints.
 */
export type ReadonlyReason =
  /** Bound to an expression that is not a plain literal (`:price="item.price * 2"`). */
  | 'advanced-binding'
  /** Dynamic argument (`:[name]="x"`). */
  | 'dynamic-argument'
  /** Element has `v-bind="obj"`, which may override any explicit prop. */
  | 'spread-binding'
  /** Attribute uses modifiers (`:title.prop`, `:foo.camel`). */
  | 'modifiers'
  /** Prop is driven by `v-model` / `v-model:arg`. */
  | 'model-binding'
  /** The same prop is written more than once (`class` + `:class`, duplicates). */
  | 'duplicate'
  /** Directive that is not a prop at all (`v-if`, `v-for`, custom directives, ...). */
  | 'directive'
  /** Special attribute with framework semantics: `is`, `key`, `ref`. */
  | 'reserved'
  /** Attribute name the tool cannot write safely (e.g. `@foo`, `[x]` from other template syntaxes). */
  | 'unsupported-name'

interface AttributeBase {
  /** Full attribute text, e.g. `title="Notebook"` or `:price="4999"`. */
  range: SourceRange
  /** Whether a visual editor may modify this attribute. */
  editable: boolean
  readonlyReason?: ReadonlyReason
}

/** `title="Notebook"`, `title='x'`, `title=x` or valueless `disabled`. */
export interface StaticAttribute extends AttributeBase {
  kind: 'static'
  name: string
  /** Decoded value (`&amp;` → `&`). `null` for valueless attributes such as `disabled`. */
  value: string | null
  nameRange: SourceRange
  /** Range of the value INCLUDING quotes, or `null` for valueless attributes. */
  valueRange: SourceRange | null
  quote: '"' | "'" | null
}

/** `:price="4999"`, `v-bind:price="x"`, `.prop="x"` or the spread form `v-bind="obj"`. */
export interface BoundAttribute extends AttributeBase {
  kind: 'bind'
  /** Prop name, or `null` for the object spread `v-bind="obj"`. */
  name: string | null
  dynamicName: boolean
  /** Raw (decoded) expression source, or `null` for the same-name shorthand `:title`. */
  expression: string | null
  expressionRange: SourceRange | null
  /** Set when the expression is a plain literal (`4999`, `'x'`, `true`, `-1`, `null`). */
  literal: LiteralValue | null
  modifiers: string[]
  rawName: string
}

/** `@click="go"`, `v-on:click="go"`, `v-on="listeners"`. */
export interface EventListenerAttribute extends AttributeBase {
  kind: 'on'
  /** Event name, or `null` for the object form `v-on="obj"`. */
  event: string | null
  dynamicName: boolean
  expression: string | null
  modifiers: string[]
  rawName: string
}

/** Any other directive: `v-if`, `v-for`, `v-model`, `v-slot`/`#name`, `v-show`, custom ones. */
export interface DirectiveAttribute extends AttributeBase {
  kind: 'directive'
  /** Directive name without the `v-` prefix (`if`, `for`, `model`, `slot`, ...). */
  name: string
  arg: string | null
  dynamicArg: boolean
  expression: string | null
  modifiers: string[]
  rawName: string
}

export type TemplateAttribute =
  StaticAttribute | BoundAttribute | EventListenerAttribute | DirectiveAttribute

/**
 * What kind of element this is, following `@vue/compiler-core`'s classification:
 * - `element`: native HTML/SVG element
 * - `component`: a Vue component (`<ProductCard>`, `<router-link>`, `<component :is>`)
 * - `slot`: a `<slot>` outlet
 * - `template`: a `<template>` wrapper (`v-if`, `v-for`, `v-slot`)
 */
export type ElementType = 'element' | 'component' | 'slot' | 'template'

/**
 * Structural features that make an element (or its subtree) harder to edit visually.
 * Their presence does not by itself make props read-only; they inform the UI and,
 * later, structural operations (insert/move/remove).
 */
export type ElementFlag =
  /** Has `v-if`, `v-else-if` or `v-else`. */
  | 'conditional'
  /** Has `v-for` — one source node renders N runtime instances. */
  | 'repeated'
  /** `<component :is="...">` — the concrete component is only known at runtime. */
  | 'dynamic-component'
  /** Has `v-bind="obj"` spread. */
  | 'spread-binding'
  /** Has `v-model`. */
  | 'model-binding'
  /** Has `v-slot`/`#name` (slot content wrapper). */
  | 'slot-content'

export interface TemplateElementNode {
  type: 'element'
  id: NodeId
  tag: string
  elementType: ElementType
  /** Whole element, from `<` of the start tag to the end of the end tag (or `/>`). */
  range: SourceRange
  /** Only the start tag, `<ProductCard ... />` or `<div ...>`. */
  startTagRange: SourceRange
  selfClosing: boolean
  attributes: TemplateAttribute[]
  flags: ElementFlag[]
  children: TemplateChildNode[]
}

export interface TemplateTextNode {
  type: 'text'
  content: string
  range: SourceRange
}

export interface TemplateInterpolationNode {
  type: 'interpolation'
  expression: string
  range: SourceRange
}

export interface TemplateCommentNode {
  type: 'comment'
  content: string
  range: SourceRange
}

export type TemplateChildNode =
  TemplateElementNode | TemplateTextNode | TemplateInterpolationNode | TemplateCommentNode

export interface TemplateModel {
  /** Template language. Only `html` is analyzed; others (e.g. `pug`) are reported as unsupported. */
  lang: string
  /** Range of the template CONTENT (between `<template>` and `</template>`). */
  range: SourceRange
  children: TemplateChildNode[]
}
