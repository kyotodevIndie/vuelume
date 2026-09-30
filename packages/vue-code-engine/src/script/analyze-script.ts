import type {
  CallExpression,
  Expression,
  LVal,
  Node,
  ObjectExpression,
  Statement,
  TSType,
  TSTypeElement,
} from '@babel/types'
import { babelParse, type SFCDescriptor } from '@vue/compiler-sfc'
import type {
  ComponentApiStyle,
  EmitDefinition,
  ImportInfo,
  PropDefinition,
  PropType,
  PropTypeKind,
} from '@vuelume/project-model'
import type { LineIndex } from '../positions.js'
import type { DiagnosticSink } from './context.js'
import { normalizeTypeText, ScriptBlock, type Located } from './context.js'
import { propTypeFromTs, resolveMembers, TypeScope } from './types.js'

export type ScriptBinding = { kind: 'import'; source: string; imported: string } | { kind: 'local' }

export interface ScriptAnalysis {
  api: ComponentApiStyle
  scriptLang?: string
  /** Name from `defineOptions({ name })` or Options API `name`. */
  declaredName?: string
  imports: ImportInfo[]
  props: PropDefinition[]
  propsComplete: boolean
  emits: EmitDefinition[]
  /** Top-level `<script setup>` / `<script>` bindings usable from the template. */
  bindings: Map<string, ScriptBinding>
}

/**
 * Analyzes `<script setup>` (and a companion `<script>`), without executing or
 * type-checking anything. Everything not understood is reported, never guessed.
 */
export function analyzeScript(
  descriptor: SFCDescriptor,
  lines: LineIndex,
  sink: DiagnosticSink,
): ScriptAnalysis {
  const setup = parseBlock(descriptor.scriptSetup, lines, sink)
  const plain = parseBlock(descriptor.script, lines, sink)
  const blocks = [setup, plain].filter((b): b is ScriptBlock => b !== null)
  const scriptLang = descriptor.scriptSetup?.lang ?? descriptor.script?.lang

  const analysis: ScriptAnalysis = {
    api: 'template-only',
    ...(scriptLang
      ? { scriptLang }
      : descriptor.scriptSetup || descriptor.script
        ? { scriptLang: 'js' }
        : {}),
    imports: blocks.flatMap((b) => collectImports(b)),
    props: [],
    propsComplete: true,
    emits: [],
    bindings: new Map(),
  }
  for (const block of blocks) collectBindings(block, analysis.bindings)

  if (setup) {
    analysis.api = 'script-setup'
    analyzeSetupMacros(setup, new TypeScope(blocks), analysis, sink)
  } else if (plain) {
    const options = findOptionsObject(plain)
    analysis.api = options ? 'options' : 'unknown'
    if (options) {
      const name = stringProperty(options, 'name')
      if (name) analysis.declaredName = name
      analysis.propsComplete = false
      sink.report(
        'component/options-api',
        'info',
        'Options API component detected; its props are not analyzed yet (only <script setup> is supported).',
        { node: options, block: plain },
      )
    } else {
      analysis.propsComplete = false
      sink.report(
        'component/unknown-script',
        'warning',
        'Could not recognize the component definition.',
      )
    }
  } else if (descriptor.script || descriptor.scriptSetup) {
    // A block exists but failed to parse; the parse error was already reported.
    analysis.api = 'unknown'
    analysis.propsComplete = false
  }
  return analysis
}

function parseBlock(
  block: SFCDescriptor['script'],
  lines: LineIndex,
  sink: DiagnosticSink,
): ScriptBlock | null {
  if (!block) return null
  if (block.src) {
    sink.report('script/external-src', 'warning', '<script src> is not supported yet.')
    return null
  }
  const lang = block.lang ?? 'js'
  const plugins: ('typescript' | 'jsx')[] = []
  if (lang === 'ts' || lang === 'tsx') plugins.push('typescript')
  if (lang === 'tsx' || lang === 'jsx') plugins.push('jsx')
  try {
    const ast = babelParse(block.content, { sourceType: 'module', plugins })
    return new ScriptBlock(block.content, block.loc.start.offset, ast.program.body, lines)
  } catch (error) {
    sink.diagnostics.push({
      code: 'script/parse-error',
      severity: 'error',
      message: `Script could not be parsed: ${(error as Error).message}`,
      location: {
        file: sink.file,
        range: lines.range(block.loc.start.offset, block.loc.end.offset),
      },
    })
    return null
  }
}

function collectImports(block: ScriptBlock): ImportInfo[] {
  return block.body.flatMap((statement): ImportInfo[] => {
    if (statement.type !== 'ImportDeclaration') return []
    const typeOnly = statement.importKind === 'type'
    return [
      {
        source: statement.source.value,
        typeOnly,
        range: block.range(statement),
        specifiers: statement.specifiers.map((s) => {
          if (s.type === 'ImportDefaultSpecifier') {
            return { kind: 'default', local: s.local.name, imported: 'default', typeOnly }
          }
          if (s.type === 'ImportNamespaceSpecifier') {
            return { kind: 'namespace', local: s.local.name, imported: '*', typeOnly }
          }
          const imported = s.imported.type === 'Identifier' ? s.imported.name : s.imported.value
          return {
            kind: 'named',
            local: s.local.name,
            imported,
            typeOnly: typeOnly || s.importKind === 'type',
          }
        }),
      },
    ]
  })
}

function collectBindings(block: ScriptBlock, bindings: Map<string, ScriptBinding>): void {
  for (const statement of block.body) {
    if (statement.type === 'ImportDeclaration') {
      if (statement.importKind === 'type') continue
      for (const s of statement.specifiers) {
        if (s.type === 'ImportSpecifier' && s.importKind === 'type') continue
        const imported =
          s.type === 'ImportDefaultSpecifier'
            ? 'default'
            : s.type === 'ImportNamespaceSpecifier'
              ? '*'
              : s.imported.type === 'Identifier'
                ? s.imported.name
                : s.imported.value
        bindings.set(s.local.name, { kind: 'import', source: statement.source.value, imported })
      }
      continue
    }
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (!declaration) continue
    if (declaration.type === 'VariableDeclaration') {
      for (const d of declaration.declarations) {
        if (d.id.type === 'Identifier') bindings.set(d.id.name, { kind: 'local' })
      }
    } else if (
      (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') &&
      declaration.id
    ) {
      bindings.set(declaration.id.name, { kind: 'local' })
    }
  }
}

// ---------------------------------------------------------------------------
// <script setup> compiler macros
// ---------------------------------------------------------------------------

interface MacroCall {
  call: CallExpression
  /** `const { a = 1 } = defineProps()` destructuring pattern, if any. */
  pattern?: LVal
  /** Second argument of `withDefaults(defineProps(), defaults)`. */
  defaults?: Expression
}

function analyzeSetupMacros(
  block: ScriptBlock,
  scope: TypeScope,
  analysis: ScriptAnalysis,
  sink: DiagnosticSink,
): void {
  for (const statement of block.body) {
    for (const macro of macroCalls(statement)) {
      const name = calleeName(macro.call)
      const at = { node: macro.call, block }
      if (name === 'defineProps') {
        const result = analyzeDefineProps(macro, block, scope, sink)
        analysis.props.push(...result.props)
        analysis.propsComplete &&= result.complete
      } else if (name === 'defineEmits') {
        analysis.emits.push(...analyzeDefineEmits(macro.call, block, scope, sink))
      } else if (name === 'defineModel') {
        const model = analyzeDefineModel(macro.call, block, scope)
        analysis.props.push(model.prop)
        analysis.emits.push(model.emit)
      } else if (name === 'defineOptions') {
        const options = macro.call.arguments[0]
        if (options?.type === 'ObjectExpression') {
          const declared = stringProperty(options, 'name')
          if (declared) analysis.declaredName = declared
        }
      } else if (name === 'defineSlots') {
        sink.report('slots/define-slots', 'info', 'defineSlots() types are not analyzed yet.', at)
      }
    }
  }
}

function macroCalls(statement: Statement): MacroCall[] {
  const candidates: { expression: Expression | null | undefined; pattern?: LVal }[] = []
  if (statement.type === 'ExpressionStatement')
    candidates.push({ expression: statement.expression })
  if (statement.type === 'VariableDeclaration') {
    for (const d of statement.declarations) {
      candidates.push({
        expression: d.init,
        ...(d.id.type === 'ObjectPattern' ? { pattern: d.id } : {}),
      })
    }
  }
  const calls: MacroCall[] = []
  for (const { expression, pattern } of candidates) {
    if (expression?.type !== 'CallExpression') continue
    if (calleeName(expression) === 'withDefaults') {
      const [inner, defaults] = expression.arguments
      if (inner?.type === 'CallExpression' && calleeName(inner) === 'defineProps') {
        calls.push({
          call: inner,
          ...(pattern ? { pattern } : {}),
          ...(defaults &&
          defaults.type !== 'SpreadElement' &&
          defaults.type !== 'ArgumentPlaceholder'
            ? { defaults }
            : {}),
        })
      }
      continue
    }
    calls.push({ call: expression, ...(pattern ? { pattern } : {}) })
  }
  return calls
}

function calleeName(call: CallExpression): string | undefined {
  return call.callee.type === 'Identifier' ? call.callee.name : undefined
}

function analyzeDefineProps(
  macro: MacroCall,
  block: ScriptBlock,
  scope: TypeScope,
  sink: DiagnosticSink,
): { props: PropDefinition[]; complete: boolean } {
  const { call } = macro
  const defaults = collectDefaults(macro, block)
  const typeArg = call.typeParameters?.params[0]
  const runtimeArg = call.arguments[0]
  let props: PropDefinition[] = []
  let complete = true

  if (typeArg) {
    const resolved = resolveMembers({ node: typeArg, block }, scope)
    for (const problem of resolved.problems) {
      sink.report(problem.code, 'warning', problem.message, problem.at)
    }
    complete = resolved.complete
    for (const member of resolved.members) {
      const prop = propFromTypeMember(member, scope)
      if (prop) props.push(prop)
      else {
        complete = false
        sink.report(
          'props/unsupported-member',
          'warning',
          `Props member "${member.block.text(member.node)}" is not supported.`,
          member,
        )
      }
    }
  } else if (runtimeArg?.type === 'ObjectExpression') {
    const result = propsFromRuntimeObject(runtimeArg, block, scope, sink)
    props = result.props
    complete = result.complete
  } else if (runtimeArg?.type === 'ArrayExpression') {
    for (const element of runtimeArg.elements) {
      if (element?.type === 'StringLiteral') {
        props.push({
          name: element.value,
          type: { text: 'any', kind: 'unknown' },
          required: false,
          range: block.range(element),
        })
      } else complete = false
    }
  } else if (runtimeArg) {
    complete = false
    sink.report(
      'props/unsupported-definition',
      'warning',
      `defineProps(${block.text(runtimeArg)}) cannot be analyzed statically.`,
      { node: runtimeArg, block },
    )
  }

  for (const prop of props) {
    const value = defaults.get(prop.name)
    if (value !== undefined) prop.default = value
  }
  return { props, complete }
}

function collectDefaults(macro: MacroCall, block: ScriptBlock): Map<string, string> {
  const defaults = new Map<string, string>()
  if (macro.defaults?.type === 'ObjectExpression') {
    for (const property of macro.defaults.properties) {
      const key = propertyKey(property)
      if (!key) continue
      if (property.type === 'ObjectProperty') defaults.set(key, block.text(property.value))
      else if (property.type === 'ObjectMethod') defaults.set(key, block.text(property))
    }
  }
  // Vue 3.5 reactive props destructure: `const { size = 'medium' } = defineProps<...>()`
  if (macro.pattern?.type === 'ObjectPattern') {
    for (const property of macro.pattern.properties) {
      if (property.type !== 'ObjectProperty' || property.value.type !== 'AssignmentPattern')
        continue
      const key = propertyKey(property)
      if (key) defaults.set(key, block.text(property.value.right))
    }
  }
  return defaults
}

function propFromTypeMember(
  member: Located<TSTypeElement>,
  scope: TypeScope,
): PropDefinition | null {
  const { node, block } = member
  if (node.type !== 'TSPropertySignature' && node.type !== 'TSMethodSignature') return null
  if (node.computed) return null
  const name = propertyKey(node)
  if (!name) return null
  const required = !node.optional
  const range = block.range(node)
  if (node.type === 'TSMethodSignature') {
    return { name, type: { text: 'function', kind: 'function' }, required, range }
  }
  const annotation = node.typeAnnotation?.typeAnnotation
  const type: PropType = annotation
    ? propTypeFromTs({ node: annotation, block }, scope)
    : { text: 'any', kind: 'unknown' }
  return { name, type, required, range }
}

const CONSTRUCTOR_TYPES: Record<string, { text: string; kind: PropTypeKind }> = {
  String: { text: 'string', kind: 'string' },
  Number: { text: 'number', kind: 'number' },
  Boolean: { text: 'boolean', kind: 'boolean' },
  Array: { text: 'unknown[]', kind: 'array' },
  Object: { text: 'object', kind: 'object' },
  Function: { text: 'function', kind: 'function' },
  Date: { text: 'Date', kind: 'reference' },
  Symbol: { text: 'symbol', kind: 'reference' },
  BigInt: { text: 'bigint', kind: 'reference' },
}

function propsFromRuntimeObject(
  object: ObjectExpression,
  block: ScriptBlock,
  scope: TypeScope,
  sink: DiagnosticSink,
): { props: PropDefinition[]; complete: boolean } {
  const props: PropDefinition[] = []
  let complete = true
  for (const property of object.properties) {
    const name = propertyKey(property)
    if (!name || property.type !== 'ObjectProperty') {
      complete = false
      sink.report(
        'props/unsupported-member',
        'warning',
        `Props entry "${block.text(property)}" cannot be analyzed statically.`,
        { node: property, block },
      )
      continue
    }
    const value = property.value as Expression
    const prop: PropDefinition = {
      name,
      type: { text: 'any', kind: 'unknown' },
      required: false,
      range: block.range(property),
    }
    if (value.type === 'ObjectExpression') {
      for (const option of value.properties) {
        if (option.type !== 'ObjectProperty') continue
        const key = propertyKey(option)
        const optionValue = option.value as Expression
        if (key === 'type') prop.type = runtimePropType(optionValue, block, scope)
        else if (key === 'required')
          prop.required = optionValue.type === 'BooleanLiteral' && optionValue.value
        else if (key === 'default') prop.default = block.text(optionValue)
      }
    } else {
      prop.type = runtimePropType(value, block, scope)
    }
    props.push(prop)
  }
  return { props, complete }
}

function runtimePropType(node: Expression, block: ScriptBlock, scope: TypeScope): PropType {
  // `Object as PropType<Product>` — trust the declared TS type.
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    const annotation = node.typeAnnotation
    if (
      annotation.type === 'TSTypeReference' &&
      annotation.typeName.type === 'Identifier' &&
      annotation.typeName.name === 'PropType' &&
      annotation.typeParameters?.params[0]
    ) {
      return propTypeFromTs({ node: annotation.typeParameters.params[0], block }, scope)
    }
    return runtimePropType(node.expression, block, scope)
  }
  if (node.type === 'Identifier') {
    return CONSTRUCTOR_TYPES[node.name] ?? { text: node.name, kind: 'reference' }
  }
  if (node.type === 'ArrayExpression') {
    const parts = node.elements.map((e) =>
      e && e.type !== 'SpreadElement' ? runtimePropType(e, block, scope) : undefined,
    )
    if (parts.some((p) => !p)) return { text: normalizeTypeText(block.text(node)), kind: 'unknown' }
    const known = parts as PropType[]
    if (known.length === 1) return known[0]!
    return { text: known.map((p) => p.text).join(' | '), kind: 'union' }
  }
  return { text: normalizeTypeText(block.text(node)), kind: 'unknown' }
}

function analyzeDefineEmits(
  call: CallExpression,
  block: ScriptBlock,
  scope: TypeScope,
  sink: DiagnosticSink,
): EmitDefinition[] {
  const emits: EmitDefinition[] = []
  const typeArg = call.typeParameters?.params[0]
  const runtimeArg = call.arguments[0]

  if (typeArg) {
    const resolved = resolveMembers({ node: typeArg, block }, scope)
    for (const problem of resolved.problems) {
      sink.report(problem.code.replace('props/', 'emits/'), 'warning', problem.message, problem.at)
    }
    for (const { node, block: memberBlock } of resolved.members) {
      if (node.type === 'TSCallSignatureDeclaration') {
        // (e: 'change', id: number): void
        const [eventParam, ...payload] = node.parameters
        const eventType = eventParam?.type === 'Identifier' ? eventParam.typeAnnotation : undefined
        const names =
          eventType?.type === 'TSTypeAnnotation' ? literalStrings(eventType.typeAnnotation) : []
        const payloadText = payload.map((p) => memberBlock.text(p)).join(', ')
        for (const name of names) {
          emits.push({
            name,
            ...(payloadText ? { payload: normalizeTypeText(payloadText) } : {}),
            range: memberBlock.range(node),
          })
        }
      } else if (node.type === 'TSPropertySignature') {
        // Vue 3.3+ named tuple syntax: { change: [id: number] }
        const name = propertyKey(node)
        if (!name) continue
        const annotation = node.typeAnnotation?.typeAnnotation
        const payload =
          annotation?.type === 'TSTupleType'
            ? normalizeTypeText(memberBlock.text(annotation).slice(1, -1))
            : undefined
        emits.push({ name, ...(payload ? { payload } : {}), range: memberBlock.range(node) })
      }
    }
  } else if (runtimeArg?.type === 'ArrayExpression') {
    for (const element of runtimeArg.elements) {
      if (element?.type === 'StringLiteral') {
        emits.push({ name: element.value, range: block.range(element) })
      }
    }
  } else if (runtimeArg?.type === 'ObjectExpression') {
    for (const property of runtimeArg.properties) {
      const name = propertyKey(property)
      if (name) emits.push({ name, range: block.range(property) })
    }
  } else if (runtimeArg) {
    sink.report(
      'emits/unsupported-definition',
      'warning',
      `defineEmits(${block.text(runtimeArg)}) cannot be analyzed statically.`,
      { node: runtimeArg, block },
    )
  }
  return emits
}

/** `defineModel()` declares a prop (`modelValue` by default) and an `update:*` event. */
function analyzeDefineModel(
  call: CallExpression,
  block: ScriptBlock,
  scope: TypeScope,
): { prop: PropDefinition; emit: EmitDefinition } {
  const [first, second] = call.arguments
  const name = first?.type === 'StringLiteral' ? first.value : 'modelValue'
  const options = first?.type === 'ObjectExpression' ? first : second
  const typeArg: TSType | undefined = call.typeParameters?.params[0]
  const prop: PropDefinition = {
    name,
    type: typeArg
      ? propTypeFromTs({ node: typeArg, block }, scope)
      : { text: 'any', kind: 'unknown' },
    required: false,
    range: block.range(call),
  }
  if (options?.type === 'ObjectExpression') {
    for (const option of options.properties) {
      if (option.type !== 'ObjectProperty') continue
      const key = propertyKey(option)
      const value = option.value as Expression
      if (key === 'required') prop.required = value.type === 'BooleanLiteral' && value.value
      else if (key === 'default') prop.default = block.text(value)
      else if (key === 'type' && !typeArg) prop.type = runtimePropType(value, block, scope)
    }
  }
  return {
    prop,
    emit: { name: `update:${name}`, payload: `value: ${prop.type.text}`, range: prop.range },
  }
}

// ---------------------------------------------------------------------------
// Options API detection (analysis itself is future work)
// ---------------------------------------------------------------------------

function findOptionsObject(block: ScriptBlock): ObjectExpression | null {
  for (const statement of block.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue
    const declaration = statement.declaration
    if (declaration.type === 'ObjectExpression') return declaration
    if (
      declaration.type === 'CallExpression' &&
      calleeName(declaration) === 'defineComponent' &&
      declaration.arguments[0]?.type === 'ObjectExpression'
    ) {
      return declaration.arguments[0]
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function propertyKey(node: Node): string | undefined {
  if (!('key' in node) || ('computed' in node && node.computed)) return undefined
  const key = node.key as Node
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  return undefined
}

function stringProperty(object: ObjectExpression, name: string): string | undefined {
  for (const property of object.properties) {
    if (property.type === 'ObjectProperty' && propertyKey(property) === name) {
      return property.value.type === 'StringLiteral' ? property.value.value : undefined
    }
  }
  return undefined
}

function literalStrings(type: TSType): string[] {
  if (type.type === 'TSLiteralType' && type.literal.type === 'StringLiteral') {
    return [type.literal.value]
  }
  if (type.type === 'TSUnionType') return type.types.flatMap(literalStrings)
  return []
}
