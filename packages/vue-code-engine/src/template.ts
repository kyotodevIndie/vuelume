import {
  ElementTypes,
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type ExpressionNode,
  type TemplateChildNode as VueChildNode,
} from '@vue/compiler-core'
import type { SFCTemplateBlock } from '@vue/compiler-sfc'
import type {
  Diagnostic,
  ElementFlag,
  ElementType,
  TemplateAttribute,
  TemplateChildNode,
  TemplateElementNode,
  TemplateModel,
} from '@vuelume/project-model'
import { readLiteral } from './literals.js'
import { camelize } from './names.js'
import type { LineIndex } from './positions.js'

const ELEMENT_TYPES: Record<ElementTypes, ElementType> = {
  [ElementTypes.ELEMENT]: 'element',
  [ElementTypes.COMPONENT]: 'component',
  [ElementTypes.SLOT]: 'slot',
  [ElementTypes.TEMPLATE]: 'template',
}

export interface TemplateBuildResult {
  template: TemplateModel | null
  diagnostics: Diagnostic[]
}

/**
 * Converts the raw (untransformed) Vue template AST into the project model.
 *
 * We deliberately read the AST produced by the *parser*, before any compiler transform:
 * at that stage `v-if`/`v-for` are still plain directives on the element that carries them,
 * so the model mirrors what the author wrote, not what the compiler generates.
 */
export function buildTemplateModel(
  block: SFCTemplateBlock | null,
  file: string,
  lines: LineIndex,
): TemplateBuildResult {
  if (!block) return { template: null, diagnostics: [] }
  const lang = block.lang ?? 'html'
  const at = { file, range: lines.range(block.loc.start.offset, block.loc.end.offset) }
  if (block.src) {
    return {
      template: null,
      diagnostics: [
        {
          code: 'template/external-src',
          severity: 'warning',
          message: 'Templates loaded from an external file (<template src>) are not supported yet.',
          location: at,
        },
      ],
    }
  }
  if (lang !== 'html' || !block.ast) {
    return {
      template: null,
      diagnostics: [
        {
          code: 'template/unsupported-lang',
          severity: 'warning',
          message: `Template language "${lang}" is not supported; only HTML templates are analyzed.`,
          location: at,
        },
      ],
    }
  }

  const builder = new ModelBuilder(lines)
  return {
    template: {
      lang,
      range: lines.range(block.loc.start.offset, block.loc.end.offset),
      children: builder.children(block.ast.children, ''),
    },
    diagnostics: [],
  }
}

class ModelBuilder {
  readonly #lines: LineIndex

  constructor(lines: LineIndex) {
    this.#lines = lines
  }

  children(nodes: VueChildNode[], parentId: string): TemplateChildNode[] {
    const result: TemplateChildNode[] = []
    let elementIndex = 0
    for (const node of nodes) {
      const range = this.#lines.range(node.loc.start.offset, node.loc.end.offset)
      switch (node.type) {
        case NodeTypes.ELEMENT: {
          const id = parentId ? `${parentId}.${elementIndex}` : String(elementIndex)
          elementIndex++
          result.push(this.element(node, id))
          break
        }
        case NodeTypes.TEXT:
          if (node.content.trim()) result.push({ type: 'text', content: node.content, range })
          break
        case NodeTypes.INTERPOLATION:
          result.push({
            type: 'interpolation',
            expression: expressionSource(node.content) ?? '',
            range,
          })
          break
        case NodeTypes.COMMENT:
          result.push({ type: 'comment', content: node.content, range })
          break
        default:
          // Compound/transformed nodes never appear in a raw parser AST.
          break
      }
    }
    return result
  }

  element(node: ElementNode, id: string): TemplateElementNode {
    const startTagEnd = node.innerLoc ? node.innerLoc.start.offset : node.loc.end.offset
    const attributes = node.props.map((p) => this.attribute(p))
    const flags = elementFlags(node, attributes)
    applyEditability(attributes, flags)
    return {
      type: 'element',
      id,
      tag: node.tag,
      elementType: ELEMENT_TYPES[node.tagType],
      range: this.#lines.range(node.loc.start.offset, node.loc.end.offset),
      startTagRange: this.#lines.range(node.loc.start.offset, startTagEnd),
      selfClosing: node.isSelfClosing === true,
      attributes,
      flags,
      children: this.children(node.children, id),
    }
  }

  attribute(prop: AttributeNode | DirectiveNode): TemplateAttribute {
    const lines = this.#lines
    const range = lines.range(prop.loc.start.offset, prop.loc.end.offset)
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const raw = prop.value?.loc.source ?? ''
      const first = raw[0]
      return {
        kind: 'static',
        name: prop.name,
        value: prop.value ? prop.value.content : null,
        range,
        nameRange: lines.range(prop.nameLoc.start.offset, prop.nameLoc.end.offset),
        valueRange: prop.value
          ? lines.range(prop.value.loc.start.offset, prop.value.loc.end.offset)
          : null,
        quote: first === '"' || first === "'" ? first : null,
        editable: true,
      }
    }

    const arg = argInfo(prop.arg)
    const expression = expressionSource(prop.exp)
    const expressionRange = prop.exp
      ? lines.range(prop.exp.loc.start.offset, prop.exp.loc.end.offset)
      : null
    const modifiers = prop.modifiers.map((m) => m.content)
    const rawName = prop.rawName ?? `v-${prop.name}`

    if (prop.name === 'bind') {
      // `.prop` / `.camel` / `.attr` shorthands are all represented as modifiers.
      return {
        kind: 'bind',
        name: arg.name,
        dynamicName: arg.dynamic,
        expression,
        expressionRange,
        literal: expression === null ? null : readLiteral(expression),
        modifiers,
        rawName,
        range,
        editable: true,
      }
    }
    if (prop.name === 'on') {
      return {
        kind: 'on',
        event: arg.name,
        dynamicName: arg.dynamic,
        expression,
        modifiers,
        rawName,
        range,
        editable: false,
        readonlyReason: 'directive',
      }
    }
    return {
      kind: 'directive',
      name: prop.name,
      arg: arg.name,
      dynamicArg: arg.dynamic,
      expression,
      modifiers,
      rawName,
      range,
      editable: false,
      readonlyReason: prop.name === 'model' ? 'model-binding' : 'directive',
    }
  }
}

function argInfo(arg: ExpressionNode | undefined): { name: string | null; dynamic: boolean } {
  if (!arg) return { name: null, dynamic: false }
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
    return { name: arg.content, dynamic: !arg.isStatic }
  }
  return { name: arg.loc.source, dynamic: true }
}

function expressionSource(exp: ExpressionNode | undefined): string | null {
  if (!exp) return null
  return exp.type === NodeTypes.SIMPLE_EXPRESSION ? exp.content : exp.loc.source
}

function elementFlags(node: ElementNode, attributes: TemplateAttribute[]): ElementFlag[] {
  const flags = new Set<ElementFlag>()
  for (const attr of attributes) {
    if (attr.kind === 'directive') {
      if (attr.name === 'if' || attr.name === 'else-if' || attr.name === 'else')
        flags.add('conditional')
      if (attr.name === 'for') flags.add('repeated')
      if (attr.name === 'model') flags.add('model-binding')
      if (attr.name === 'slot') flags.add('slot-content')
    }
    if (attr.kind === 'bind' && attr.name === null) flags.add('spread-binding')
  }
  if (node.tag === 'component' || node.tag === 'Component') flags.add('dynamic-component')
  return [...flags]
}

/**
 * Decides, per attribute, whether a visual editor may change it.
 * This is the single source of truth for "safe subset" rules at the attribute level;
 * the transformations re-check the same rules through {@link propEditBlocker}.
 */
function applyEditability(attributes: TemplateAttribute[], flags: ElementFlag[]): void {
  const counts = new Map<string, number>()
  for (const attr of attributes) {
    const key = propKey(attr)
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const modelArgs = new Set(
    attributes.flatMap((a) =>
      a.kind === 'directive' && a.name === 'model' ? [camelize(a.arg ?? 'modelValue')] : [],
    ),
  )

  for (const attr of attributes) {
    if (attr.kind !== 'static' && attr.kind !== 'bind') continue
    const reason = propEditBlocker(attr, flags, counts, modelArgs)
    if (reason) {
      attr.editable = false
      attr.readonlyReason = reason
    }
  }
}

/** Attributes with framework semantics that are never edited as props. */
export const RESERVED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'is',
  'key',
  'ref',
  'ref_for',
  'ref_key',
])

/** Normalized prop name an attribute writes to, or `null` if it is not a named prop. */
export function propKey(attr: TemplateAttribute): string | null {
  if (attr.kind === 'static') return camelize(attr.name)
  if (attr.kind === 'bind' && attr.name !== null && !attr.dynamicName) return camelize(attr.name)
  return null
}

export function propEditBlocker(
  attr: TemplateAttribute,
  flags: readonly ElementFlag[],
  counts: ReadonlyMap<string, number>,
  modelArgs: ReadonlySet<string>,
): TemplateAttribute['readonlyReason'] | undefined {
  if (attr.kind === 'bind') {
    if (attr.name === null) return 'spread-binding'
    if (attr.dynamicName) return 'dynamic-argument'
  } else if (attr.kind !== 'static') {
    return attr.kind === 'directive' && attr.name === 'model' ? 'model-binding' : 'directive'
  }
  const key = propKey(attr)
  if (key && RESERVED_ATTRIBUTES.has(key)) return 'reserved'
  if (flags.includes('spread-binding')) return 'spread-binding'
  if (key && modelArgs.has(key)) return 'model-binding'
  if (key && (counts.get(key) ?? 0) > 1) return 'duplicate'
  if (attr.kind === 'bind') {
    if (attr.modifiers.length > 0) return 'modifiers'
    if (!attr.literal) return 'advanced-binding'
  }
  return undefined
}
