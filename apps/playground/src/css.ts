/** Splits an inline `style` value into declarations, on top-level `;` only (`url(a;b)` is kept). */
export function parseDeclarations(text: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ';' && depth === 0) {
      out.push(splitDeclaration(current))
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(splitDeclaration(current))
  return out.filter(([property]) => property)
}

function splitDeclaration(declaration: string): [string, string] {
  const index = declaration.indexOf(':')
  return index < 0
    ? [declaration.trim(), '']
    : [declaration.slice(0, index).trim(), declaration.slice(index + 1).trim()]
}

/** Serializes declarations back (empty values are dropped). */
export function serializeDeclarations(declarations: [string, string][]): string {
  return declarations
    .filter(([property, value]) => property && value)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
}
