import type {
  Node,
  Statement,
  TSInterfaceDeclaration,
  TSType,
  TSTypeAliasDeclaration,
  TSTypeElement,
} from '@babel/types'
import type { PropType } from '@vuelume/project-model'
import { normalizeTypeText, type Located, type ScriptBlock } from './context.js'

type TypeDeclaration = TSInterfaceDeclaration | TSTypeAliasDeclaration

/**
 * Type declarations visible to `<script setup>` within the same file.
 *
 * Cross-file resolution (imported types, global types, `extends` of imported interfaces)
 * is intentionally out of scope for now — see ADR-0005.
 */
export class TypeScope {
  readonly #declarations = new Map<string, Located<TypeDeclaration>>()
  readonly #importedTypes = new Map<string, string>()

  constructor(blocks: ScriptBlock[]) {
    for (const block of blocks) {
      for (const statement of block.body) {
        const declaration = unwrapExport(statement)
        if (
          declaration &&
          (declaration.type === 'TSInterfaceDeclaration' ||
            declaration.type === 'TSTypeAliasDeclaration')
        ) {
          this.#declarations.set(declaration.id.name, { node: declaration, block })
        }
        if (statement.type === 'ImportDeclaration') {
          for (const specifier of statement.specifiers) {
            this.#importedTypes.set(specifier.local.name, statement.source.value)
          }
        }
      }
    }
  }

  lookup(name: string): Located<TypeDeclaration> | undefined {
    return this.#declarations.get(name)
  }

  importSourceOf(name: string): string | undefined {
    return this.#importedTypes.get(name)
  }
}

function unwrapExport(statement: Statement): Node | null | undefined {
  if (statement.type === 'ExportNamedDeclaration') return statement.declaration
  return statement
}

export interface MembersResult {
  members: Located<TSTypeElement>[]
  /** `false` when part of the type could not be resolved. */
  complete: boolean
  /** Human readable reasons for incompleteness (turned into diagnostics by the caller). */
  problems: { code: string; message: string; at: Located<Node> }[]
}

/** Resolves an object-like type (`{...}`, local interface/alias, intersections) to its members. */
export function resolveMembers(
  type: Located<TSType>,
  scope: TypeScope,
  seen = new Set<string>(),
): MembersResult {
  const { node, block } = type
  const result: MembersResult = { members: [], complete: true, problems: [] }
  const merge = (other: MembersResult) => {
    result.members.push(...other.members)
    result.complete &&= other.complete
    result.problems.push(...other.problems)
  }
  const fail = (code: string, message: string) => {
    result.complete = false
    result.problems.push({ code, message, at: type })
  }

  switch (node.type) {
    case 'TSTypeLiteral':
      result.members.push(...node.members.map((m) => ({ node: m, block })))
      return result
    case 'TSParenthesizedType':
      return resolveMembers({ node: node.typeAnnotation, block }, scope, seen)
    case 'TSIntersectionType':
      for (const part of node.types) merge(resolveMembers({ node: part, block }, scope, seen))
      return result
    case 'TSTypeReference':
      if (node.typeName.type !== 'Identifier' || node.typeParameters) {
        fail(
          'props/unsupported-type',
          `Type "${block.text(node)}" cannot be resolved yet (generic or qualified types are not supported).`,
        )
        return result
      }
      merge(resolveNamedType(node.typeName.name, type, scope, seen))
      return result
    default:
      fail(
        'props/unsupported-type',
        `Type "${block.text(node)}" cannot be resolved to a list of props yet.`,
      )
      return result
  }
}

function resolveNamedType(
  name: string,
  at: Located<Node>,
  scope: TypeScope,
  seen: Set<string>,
): MembersResult {
  const result: MembersResult = { members: [], complete: true, problems: [] }
  if (seen.has(name)) return result
  seen.add(name)

  const declaration = scope.lookup(name)
  if (!declaration) {
    const source = scope.importSourceOf(name)
    result.complete = false
    result.problems.push({
      code: source ? 'props/imported-type' : 'props/unresolved-type',
      message: source
        ? `Type "${name}" is imported from "${source}"; cross-file type resolution is not implemented yet.`
        : `Type "${name}" is not declared in this file.`,
      at,
    })
    return result
  }

  const { node: decl, block } = declaration
  if (decl.type === 'TSTypeAliasDeclaration') {
    return resolveMembers({ node: decl.typeAnnotation, block }, scope, seen)
  }
  for (const heritage of decl.extends ?? []) {
    const parent = heritage.expression
    if (parent.type === 'Identifier' && !heritage.typeParameters) {
      const inherited = resolveNamedType(parent.name, { node: heritage, block }, scope, seen)
      result.members.push(...inherited.members)
      result.complete &&= inherited.complete
      result.problems.push(...inherited.problems)
    } else {
      result.complete = false
      result.problems.push({
        code: 'props/unsupported-type',
        message: `Interface "${name}" extends "${block.text(heritage)}", which cannot be resolved yet.`,
        at: { node: heritage, block },
      })
    }
  }
  result.members.push(...decl.body.body.map((m) => ({ node: m, block })))
  return result
}

/** Describes a TS type annotation as a {@link PropType}, keeping the author's text. */
export function propTypeFromTs(type: Located<TSType>, scope: TypeScope): PropType {
  const text = normalizeTypeText(type.block.text(type.node))
  return { text, ...classify(type, scope, new Set()) }
}

type Classification = Pick<PropType, 'kind' | 'options'>

function classify(type: Located<TSType>, scope: TypeScope, seen: Set<string>): Classification {
  const { node, block } = type
  switch (node.type) {
    case 'TSStringKeyword':
      return { kind: 'string' }
    case 'TSNumberKeyword':
      return { kind: 'number' }
    case 'TSBooleanKeyword':
      return { kind: 'boolean' }
    case 'TSParenthesizedType':
      return classify({ node: node.typeAnnotation, block }, scope, seen)
    case 'TSArrayType':
    case 'TSTupleType':
      return { kind: 'array' }
    case 'TSTypeLiteral':
    case 'TSMappedType':
      return { kind: 'object' }
    case 'TSFunctionType':
      return { kind: 'function' }
    case 'TSLiteralType': {
      const value = literalTypeValue(node.literal)
      return value === undefined ? { kind: 'unknown' } : { kind: 'enum', options: [value] }
    }
    case 'TSUnionType': {
      const parts = node.types.filter(
        (t) => t.type !== 'TSUndefinedKeyword' && t.type !== 'TSNullKeyword',
      )
      if (parts.length === 1) return classify({ node: parts[0]!, block }, scope, seen)
      const classified = parts.map((t) => classify({ node: t, block }, scope, seen))
      if (classified.every((c) => c.kind === 'enum')) {
        const options = classified.flatMap((c) => c.options ?? [])
        if (options.length === 2 && options.includes(true) && options.includes(false)) {
          return { kind: 'boolean' }
        }
        return { kind: 'enum', options }
      }
      return { kind: 'union' }
    }
    case 'TSTypeReference': {
      if (node.typeName.type !== 'Identifier') return { kind: 'reference' }
      const name = node.typeName.name
      if (name === 'Array' || name === 'ReadonlyArray') return { kind: 'array' }
      if (name === 'Record') return { kind: 'object' }
      if (name === 'Function') return { kind: 'function' }
      const declaration = scope.lookup(name)
      if (declaration?.node.type === 'TSTypeAliasDeclaration' && !seen.has(name)) {
        seen.add(name)
        const resolved = classify(
          { node: declaration.node.typeAnnotation, block: declaration.block },
          scope,
          seen,
        )
        // A local alias to a literal union (`type Size = 'sm' | 'lg'`) is still an enum.
        if (resolved.kind !== 'object') return resolved
      }
      return declaration?.node.type === 'TSInterfaceDeclaration'
        ? { kind: 'object' }
        : { kind: 'reference' }
    }
    default:
      return { kind: 'unknown' }
  }
}

function literalTypeValue(literal: Node): string | number | boolean | undefined {
  switch (literal.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return literal.value
    case 'UnaryExpression':
      return literal.operator === '-' && literal.argument.type === 'NumericLiteral'
        ? -literal.argument.value
        : undefined
    default:
      return undefined
  }
}
