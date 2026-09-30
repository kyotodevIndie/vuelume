import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findElementById } from '@vuelume/project-model'
import { analyzeComponent, checkRoundTrip, setProp } from '@vuelume/vue-code-engine'
import { describe, expect, it } from 'vitest'

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))
const exampleDir = fileURLToPath(new URL('../../../examples/basic-shop/src', import.meta.url))

async function vueFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.vue'))
    .map((e) => path.join(e.parentPath, e.name))
}

describe('checkRoundTrip over fixtures and the example project', async () => {
  const files = [...(await vueFiles(fixturesDir)), ...(await vueFiles(exampleDir))]

  it('found the files', () => {
    expect(files.length).toBeGreaterThanOrEqual(12)
  })

  for (const file of files) {
    it(path.basename(file), async () => {
      const report = checkRoundTrip(await readFile(file, 'utf8'), path.basename(file))
      expect(report.checked).toBe(true)
      expect(report.failures).toEqual([])
      expect(report.passed).toBeGreaterThan(0)
    })
  }
})

describe('hostile fixtures', () => {
  it('preserves CRLF and the BOM', async () => {
    const source = await readFile(path.join(fixturesDir, 'crlf-bom.vue'), 'utf8')
    expect(source.startsWith('﻿')).toBe(true)
    const result = setProp(source, { nodeId: '0.0', name: 'badge', value: 'new' })
    expect(result.ok && result.code).toBe(
      source.replace('      :count="1"\r\n', '      :count="1"\r\n      badge="new"\r\n'),
    )
  })

  it('keeps unquoted values unquoted when possible', async () => {
    const source = await readFile(path.join(fixturesDir, 'messy-formatting.vue'), 'utf8')
    const simple = setProp(source, { nodeId: '0', name: 'id', value: 'main' })
    expect(simple.ok && simple.code).toBe(source.replace('id=app', 'id=main'))
    const complex = setProp(source, { nodeId: '0', name: 'id', value: 'a b' })
    expect(complex.ok && complex.code).toBe(source.replace('id=app', 'id="a b"'))
  })

  it('marks is/key/ref as reserved', async () => {
    const source = await readFile(path.join(fixturesDir, 'slots-and-directives.vue'), 'utf8')
    const template = analyzeComponent(source, { filename: 'x.vue' }).template!
    const dynamic = findElementById(template, '1')!
    expect(dynamic.attributes[0]).toMatchObject({ editable: false, readonlyReason: 'reserved' })
  })
})
