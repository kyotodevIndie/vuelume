import { parseExpression } from '@babel/parser'
import type { Expression } from '@babel/types'
import type { LiteralValue } from '@vuelume/project-model'

/** Parses a template/script expression. Returns `null` when it is not valid JS/TS. */
export function tryParseExpression(code: string): Expression | null {
  try {
    return parseExpression(code, { plugins: ['typescript'] })
  } catch {
    return null
  }
}

/**
 * Reads the value of an expression if — and only if — it is a plain literal.
 * `"'x'"`, `4999`, `-1`, `true`, `null`, `` `x` `` (no substitutions) are literals;
 * anything referencing identifiers or computing something is not.
 */
export function readLiteral(code: string): LiteralValue | null {
  const node = tryParseExpression(code)
  return node ? literalFromNode(node) : null
}

export function literalFromNode(node: Expression): LiteralValue | null {
  switch (node.type) {
    case 'StringLiteral':
      return { type: 'string', value: node.value }
    case 'NumericLiteral':
      return { type: 'number', value: node.value }
    case 'BooleanLiteral':
      return { type: 'boolean', value: node.value }
    case 'NullLiteral':
      return { type: 'null' }
    case 'Identifier':
      return node.name === 'undefined' ? { type: 'undefined' } : null
    case 'TemplateLiteral': {
      const quasi = node.quasis[0]
      if (node.expressions.length > 0 || !quasi || quasi.value.cooked == null) return null
      return { type: 'string', value: quasi.value.cooked }
    }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
        return { type: 'number', value: -node.argument.value }
      }
      return null
    default:
      return null
  }
}

/**
 * Serializes a value as a JavaScript literal.
 * @param preferredQuote quote for strings; must differ from the enclosing HTML attribute quote.
 */
export function serializeJsLiteral(
  value: string | number | boolean,
  preferredQuote: '"' | "'",
): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Cannot serialize non-finite number ${value}`)
    return Object.is(value, -0) ? '-0' : String(value)
  }
  if (typeof value === 'boolean') return String(value)
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replaceAll(preferredQuote, `\\${preferredQuote}`)
  return preferredQuote + escaped + preferredQuote
}

/**
 * Escapes text to be placed inside a quoted HTML attribute value.
 * Only what is needed for a lossless round-trip through the Vue parser is escaped:
 * the enclosing quote and `&` when it could start a character reference.
 */
export function escapeAttributeValue(value: string, quote: '"' | "'"): string {
  return value
    .replace(/&(?=[a-zA-Z#])/g, '&amp;')
    .replaceAll(quote, quote === '"' ? '&quot;' : '&#39;')
}
