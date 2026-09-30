import type { NodeId, TemplateChildNode, TemplateElementNode, TemplateModel } from './template.js'

type Container = TemplateModel | TemplateElementNode

/** Depth-first, pre-order iteration over every element of a template. */
export function* walkElements(root: Container): Generator<TemplateElementNode> {
  for (const child of root.children) {
    if (child.type === 'element') {
      yield child
      yield* walkElements(child)
    }
  }
}

/** Source → model: find the element with a given {@link NodeId}. */
export function findElementById(
  template: TemplateModel,
  nodeId: NodeId,
): TemplateElementNode | undefined {
  const indices = nodeId.split('.').map(Number)
  let children: TemplateChildNode[] = template.children
  let found: TemplateElementNode | undefined
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0) return undefined
    found = children.filter((c) => c.type === 'element')[index]
    if (!found) return undefined
    children = found.children
  }
  return found
}

/**
 * Model ← source: find the innermost element whose range contains `offset`
 * (e.g. the element under the cursor in a code editor).
 */
export function findElementAtOffset(
  template: TemplateModel,
  offset: number,
): TemplateElementNode | undefined {
  let match: TemplateElementNode | undefined
  let children: TemplateChildNode[] = template.children
  for (;;) {
    const next = children.find(
      (c): c is TemplateElementNode =>
        c.type === 'element' && c.range.start.offset <= offset && offset < c.range.end.offset,
    )
    if (!next) return match
    match = next
    children = next.children
  }
}
