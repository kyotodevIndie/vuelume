import { MagicString } from '@vue/compiler-sfc'
import type { ComponentModel, ComponentUsage } from '@vuelume/project-model'
import { walkElements } from '@vuelume/project-model'
import { analyzeComponent } from '@vuelume/vue-code-engine'
import {
  encodeLocator,
  fileHash,
  NODE_ATTRIBUTE,
  USAGE_ATTRIBUTE_PREFIX,
} from '@vuelume/project-model'

export interface InstrumentOptions {
  /** Project-relative POSIX path used in locators. */
  file: string
  /**
   * Decides whether a component usage may receive a (fallthrough) marker attribute.
   * Return `false` for components known to render multiple roots, where Vue would warn about
   * extraneous attributes. Defaults to `true`.
   */
  markUsage?: (usage: ComponentUsage) => boolean
}

export interface InstrumentResult {
  code: string
  map: ReturnType<MagicString['generateMap']>
  model: ComponentModel
}

const SKIPPED_COMPONENTS = new Set([
  'component',
  'Component',
  'transition',
  'Transition',
  'transition-group',
  'TransitionGroup',
  'keep-alive',
  'KeepAlive',
  'teleport',
  'Teleport',
  'suspense',
  'Suspense',
])

/**
 * Adds canvas ↔ source markers to a `.vue` source **in memory** (dev server only; the file on
 * disk is never modified):
 *
 * - native elements get `data-vl="<file>:<nodeId>"` — the element's authoring site, which is
 *   also correct for slot content (compiled in the parent file);
 * - component usages get `data-vl-u-<hash(file)>="<file>:<nodeId>"`, which falls through to the
 *   child's root element and identifies the usage site of that component instance.
 *
 * Markers are inserted right after the tag name, so the rest of the start tag is untouched and
 * line numbers are preserved (a source map is returned for columns).
 * Returns `null` when the file cannot be analyzed safely (no template or parse errors).
 */
export function instrumentSfc(source: string, options: InstrumentOptions): InstrumentResult | null {
  const model = analyzeComponent(source, { filename: options.file })
  if (!model.template || model.diagnostics.some((d) => d.code === 'sfc/parse-error')) return null

  const usages = new Map(model.usages.map((u) => [u.nodeId, u]))
  const s = new MagicString(source)
  const usageAttribute = USAGE_ATTRIBUTE_PREFIX + fileHash(options.file)

  for (const element of walkElements(model.template)) {
    const at = element.range.start.offset + 1 + element.tag.length
    const value = encodeLocator({ file: options.file, nodeId: element.id })
    if (element.elementType === 'element') {
      s.appendLeft(at, ` ${NODE_ATTRIBUTE}="${value}"`)
    } else if (element.elementType === 'component' && !SKIPPED_COMPONENTS.has(element.tag)) {
      const usage = usages.get(element.id)
      if (usage?.resolution === 'builtin') continue
      if (usage && options.markUsage && !options.markUsage(usage)) continue
      s.appendLeft(at, ` ${usageAttribute}="${value}"`)
    }
    // `<template>` and `<slot>` render no element of their own: nothing to mark.
  }

  return {
    code: s.toString(),
    map: s.generateMap({ source: options.file, hires: true, includeContent: true }),
    model,
  }
}

/**
 * `true` when attributes passed to this component land on exactly one root element
 * (so a marker attribute will not trigger Vue's "extraneous non-props attributes" warning).
 */
export function hasSingleRootElement(model: ComponentModel): boolean {
  if (!model.template) return false
  const roots = model.template.children.filter((c) => c.type !== 'comment')
  const [root] = roots
  return (
    roots.length === 1 &&
    root?.type === 'element' &&
    root.elementType !== 'template' &&
    root.elementType !== 'slot'
  )
}
