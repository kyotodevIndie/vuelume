import { parse } from '@vue/compiler-sfc'
import type {
  ComponentModel,
  ComponentUsage,
  Diagnostic,
  SlotDefinition,
  TemplateModel,
} from '@vuelume/project-model'
import { walkElements } from '@vuelume/project-model'
import { camelize, componentNameFromFile, pascalize } from './names.js'
import { LineIndex } from './positions.js'
import { analyzeScript, type ScriptBinding } from './script/analyze-script.js'
import { DiagnosticSink } from './script/context.js'
import { buildTemplateModel } from './template.js'

export interface AnalyzeOptions {
  /**
   * Path used to identify the file in the model (project-relative, POSIX separators).
   * The engine never reads the file system — this is only a label.
   */
  filename: string
}

/**
 * Analyzes one `.vue` file into a {@link ComponentModel}.
 * Pure function: source in, JSON-serializable model out. Never throws on user code.
 */
export function analyzeComponent(source: string, options: AnalyzeOptions): ComponentModel {
  const { filename } = options
  const lines = new LineIndex(source)
  const sink = new DiagnosticSink(filename)
  const { descriptor, errors } = parse(source, { filename, sourceMap: false })

  for (const error of errors) sink.diagnostics.push(parseErrorDiagnostic(error, filename, lines))

  const script = analyzeScript(descriptor, lines, sink)
  const { template, diagnostics: templateDiagnostics } = buildTemplateModel(
    descriptor.template,
    filename,
    lines,
  )
  sink.diagnostics.push(...templateDiagnostics)

  return {
    file: filename,
    name: script.declaredName ?? componentNameFromFile(filename),
    api: script.api,
    ...(script.scriptLang ? { scriptLang: script.scriptLang } : {}),
    props: script.props,
    propsComplete: script.propsComplete,
    emits: script.emits,
    slots: template ? collectSlots(template) : [],
    imports: script.imports,
    template,
    usages: template ? collectUsages(template, script.bindings) : [],
    diagnostics: sink.diagnostics,
  }
}

export function parseErrorDiagnostic(
  error: Error | { message: string; loc?: { start: { offset: number }; end: { offset: number } } },
  file: string,
  lines: LineIndex,
): Diagnostic {
  const loc = 'loc' in error ? error.loc : undefined
  return {
    code: 'sfc/parse-error',
    severity: 'error',
    message: error.message,
    ...(loc ? { location: { file, range: lines.range(loc.start.offset, loc.end.offset) } } : {}),
  }
}

const BUILTIN_COMPONENTS = new Set([
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'Teleport',
  'Suspense',
  'Component',
  'Slot',
])

/**
 * Resolves each component tag the same way `<script setup>` compilation does:
 * exact binding name, then camelCase, then PascalCase (`product-card` → `ProductCard`).
 */
function collectUsages(
  template: TemplateModel,
  bindings: Map<string, ScriptBinding>,
): ComponentUsage[] {
  const usages: ComponentUsage[] = []
  for (const element of walkElements(template)) {
    if (element.elementType !== 'component') continue
    const tag = element.tag
    // `<Foo.Bar>` resolves through the `Foo` binding.
    const head = tag.split('.')[0]!
    const candidates = [head, camelize(head), pascalize(head)]
    const binding = candidates.find((c) => bindings.has(c))
    if (binding) {
      const info = bindings.get(binding)!
      usages.push({
        nodeId: element.id,
        tag,
        binding,
        ...(info.kind === 'import'
          ? { resolution: 'import', importSource: info.source }
          : { resolution: 'local' }),
      })
    } else if (BUILTIN_COMPONENTS.has(pascalize(tag))) {
      usages.push({ nodeId: element.id, tag, resolution: 'builtin' })
    } else {
      usages.push({ nodeId: element.id, tag, resolution: 'unresolved' })
    }
  }
  return usages
}

function collectSlots(template: TemplateModel): SlotDefinition[] {
  const slots: SlotDefinition[] = []
  for (const element of walkElements(template)) {
    if (element.elementType !== 'slot') continue
    let name: string | null = 'default'
    for (const attr of element.attributes) {
      if (attr.kind === 'static' && attr.name === 'name') name = attr.value ?? 'default'
      if (attr.kind === 'bind' && attr.name === 'name') name = null
    }
    slots.push({ name, nodeId: element.id })
  }
  return slots
}
