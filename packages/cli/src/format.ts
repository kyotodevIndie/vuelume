import type {
  ComponentModel,
  Diagnostic,
  ProjectModel,
  TemplateAttribute,
  TemplateChildNode,
  TemplateModel,
} from '@vuelume/project-model'

/** Human-readable summary of a project, in the shape of the project brief. */
export function formatProject(project: ProjectModel, displayRoot: string): string {
  const out: string[] = []
  const count = project.components.length
  out.push(`Found ${count} Vue component${count === 1 ? '' : 's'} in ${displayRoot}`, '')

  const names = new Map(project.components.map((c) => [c.file, c.name]))
  for (const component of project.components) {
    out.push(...formatComponent(component, names), '')
  }

  const all = [...project.diagnostics, ...project.components.flatMap((c) => c.diagnostics)]
  const warnings = all.filter((d) => d.severity !== 'info').length
  out.push(
    `${count} components, ${project.files.length} source files, ${warnings} warning(s), ${all.length - warnings} note(s).`,
  )
  for (const diagnostic of project.diagnostics) out.push(formatDiagnostic(diagnostic, ''))
  return out.join('\n')
}

function formatComponent(component: ComponentModel, names: Map<string, string>): string[] {
  const out = [`${component.name}  (${component.file})`]
  if (component.api === 'options') out.push('  (Options API — props not analyzed yet)')

  if (component.props.length > 0) {
    out.push('  props')
    for (const prop of component.props) {
      const optional = prop.required ? '' : '?'
      const fallback = prop.default !== undefined ? ` = ${prop.default}` : ''
      out.push(`    ${prop.name}${optional}: ${prop.type.text}${fallback}`)
    }
  }
  if (component.emits.length > 0) {
    out.push('  emits')
    for (const emit of component.emits)
      out.push(`    ${emit.name}${emit.payload ? `(${emit.payload})` : ''}`)
  }
  if (component.slots.length > 0) {
    out.push('  slots')
    for (const slot of component.slots) out.push(`    ${slot.name ?? '(dynamic)'}`)
  }

  const used = new Map<string, string>()
  for (const usage of component.usages) {
    const label = usage.resolvedFile
      ? (names.get(usage.resolvedFile) ?? usage.tag)
      : usage.resolution === 'unresolved'
        ? `${usage.tag} (unresolved)`
        : usage.tag
    used.set(label, label)
  }
  if (used.size > 0) out.push(`  uses  ${[...used.keys()].join(', ')}`)

  for (const diagnostic of component.diagnostics) out.push(formatDiagnostic(diagnostic, '  '))
  return out
}

export function formatDiagnostic(diagnostic: Diagnostic, indent: string): string {
  const icon = diagnostic.severity === 'info' ? 'ℹ' : diagnostic.severity === 'warning' ? '⚠' : '✖'
  const where = diagnostic.location
    ? ` (${diagnostic.location.file}:${diagnostic.location.range.start.line}:${diagnostic.location.range.start.column})`
    : ''
  return `${indent}${icon} ${diagnostic.message} [${diagnostic.code}]${where}`
}

/** Template tree with node ids, locations and per-attribute editability. */
export function formatTemplateTree(file: string, template: TemplateModel, source: string): string {
  const out = [`${file}`]
  const visit = (nodes: TemplateChildNode[], depth: number) => {
    for (const node of nodes) {
      if (node.type !== 'element') continue
      const pad = '  '.repeat(depth)
      const flags = node.flags.length ? `  [${node.flags.join(', ')}]` : ''
      const at = `${node.range.start.line}:${node.range.start.column}`
      out.push(`${pad}${node.id.padEnd(8)} <${node.tag}>  ${node.elementType} @ ${at}${flags}`)
      for (const attr of node.attributes) {
        out.push(`${pad}${' '.repeat(10)}${attributeText(attr, source)}${editability(attr)}`)
      }
      visit(node.children, depth + 1)
    }
  }
  visit(template.children, 0)
  return out.join('\n')
}

function attributeText(attr: TemplateAttribute, source: string): string {
  const text = source.slice(attr.range.start.offset, attr.range.end.offset).replace(/\s+/g, ' ')
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

function editability(attr: TemplateAttribute): string {
  if (attr.editable) return '  ✎ editable'
  if (attr.kind === 'on' || attr.readonlyReason === 'directive') return ''
  return `  ⚠ ${attr.readonlyReason} — open in code`
}

/**
 * Compact single-hunk diff (edits are local, so one hunk is enough) with line numbers.
 */
export function formatChange(before: string, after: string, context = 2): string {
  const a = before.split('\n')
  const b = after.split('\n')
  let top = 0
  while (top < a.length && top < b.length && a[top] === b[top]) top++
  let bottom = 0
  while (
    bottom < a.length - top &&
    bottom < b.length - top &&
    a[a.length - 1 - bottom] === b[b.length - 1 - bottom]
  ) {
    bottom++
  }
  const from = Math.max(0, top - context)
  const out: string[] = []
  const line = (n: number, mark: string, text: string) =>
    out.push(`${String(n + 1).padStart(4)} ${mark} ${text.replace(/\r$/, '')}`)
  for (let i = from; i < top; i++) line(i, ' ', a[i]!)
  for (let i = top; i < a.length - bottom; i++) line(i, '-', a[i]!)
  for (let i = top; i < b.length - bottom; i++) line(i, '+', b[i]!)
  for (let i = b.length - bottom; i < Math.min(b.length, b.length - bottom + context); i++) {
    line(i, ' ', b[i]!)
  }
  return out.join('\n')
}
