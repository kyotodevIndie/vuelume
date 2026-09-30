import type { TemplateAttribute } from '@vuelume/project-model'
import { findElementById, walkElements } from '@vuelume/project-model'
import { analyzeComponent } from '../analyze.js'
import { removeProp, setProp } from '../transform/props.js'

/** A value that exercises quoting and escaping on purpose. */
const PROBE_VALUE = `probe "double" 'single' & <tag> &amp;`
const PROBE_NAME = 'data-vuelume-probe'

export interface RoundTripFailure {
  nodeId: string
  operation: string
  detail: string
}

export interface RoundTripReport {
  file: string
  /** `false` when the file could not be checked at all (parse errors, no template). */
  checked: boolean
  elements: number
  /** Transformations that succeeded and round-tripped exactly. */
  passed: number
  /** Transformations the engine refused (outside the safe subset) — expected, not a failure. */
  refused: number
  failures: RoundTripFailure[]
}

/**
 * Stress-tests the engine on an existing file, entirely in memory (nothing is written):
 *
 * 1. for every editable static attribute: set a tricky value, check it reads back,
 *    set the original value again and check the file is restored;
 * 2. for every element: add a new attribute, then remove it, and check the file is
 *    byte-for-byte identical to the original.
 *
 * Any mismatch is a bug in the engine. Running this over real-world projects is how we
 * measure whether "never corrupt code" holds outside our own fixtures.
 */
export function checkRoundTrip(source: string, filename: string): RoundTripReport {
  const report: RoundTripReport = {
    file: filename,
    checked: false,
    elements: 0,
    passed: 0,
    refused: 0,
    failures: [],
  }
  const model = analyzeComponent(source, { filename })
  if (!model.template || model.diagnostics.some((d) => d.code === 'sfc/parse-error')) return report
  report.checked = true

  const fail = (nodeId: string, operation: string, detail: string) =>
    report.failures.push({ nodeId, operation, detail })

  for (const element of walkElements(model.template)) {
    report.elements++
    if (element.elementType === 'template') continue
    const nodeId = element.id

    for (const attr of element.attributes) {
      if (attr.kind !== 'static' || !attr.editable || attr.value === null) continue
      const operation = `setProp ${attr.name}`
      // Unquoted values (`id=app`) can only hold simple values; a tricky probe would force quotes
      // and make an exact restore impossible by design.
      const probe = attr.quote === null ? 'vuelume-probe' : PROBE_VALUE
      const changed = setProp(source, { filename, nodeId, name: attr.name, value: probe })
      if (!changed.ok) {
        if (changed.error.code === 'readonly') report.refused++
        else fail(nodeId, operation, `${changed.error.code}: ${changed.error.message}`)
        continue
      }
      const readBack = readStatic(changed.code, filename, nodeId, attr.name)
      if (readBack !== probe) {
        fail(nodeId, operation, `read back ${JSON.stringify(readBack)}`)
        continue
      }
      const restored = setProp(changed.code, {
        filename,
        nodeId,
        name: attr.name,
        value: attr.value,
      })
      if (!restored.ok) {
        fail(nodeId, `${operation} (restore)`, restored.error.message)
        continue
      }
      // Byte-identical unless the original used character references (`&lt;` is restored as `<`).
      const exact = !rawValue(source, attr).includes('&')
      if (
        exact
          ? restored.code !== source
          : readStatic(restored.code, filename, nodeId, attr.name) !== attr.value
      ) {
        fail(nodeId, `${operation} (restore)`, 'file not restored')
        continue
      }
      report.passed++
    }

    const added = setProp(source, { filename, nodeId, name: PROBE_NAME, value: 'x' })
    if (!added.ok) {
      if (added.error.code === 'readonly') report.refused++
      else fail(nodeId, 'setProp (insert)', `${added.error.code}: ${added.error.message}`)
      continue
    }
    const removed = removeProp(added.code, { filename, nodeId, name: PROBE_NAME })
    if (!removed.ok) fail(nodeId, 'removeProp', removed.error.message)
    else if (removed.code !== source) fail(nodeId, 'insert + remove', 'file not restored')
    else report.passed++
  }
  return report
}

function readStatic(
  code: string,
  filename: string,
  nodeId: string,
  name: string,
): string | null | undefined {
  const template = analyzeComponent(code, { filename }).template
  const element = template ? findElementById(template, nodeId) : undefined
  const attr = element?.attributes.find((a) => a.kind === 'static' && a.name === name)
  return attr?.kind === 'static' ? attr.value : undefined
}

function rawValue(source: string, attr: TemplateAttribute): string {
  return attr.kind === 'static' && attr.valueRange
    ? source.slice(attr.valueRange.start.offset, attr.valueRange.end.offset)
    : ''
}
