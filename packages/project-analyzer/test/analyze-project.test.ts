import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProject, discoverSourceFiles, resolveImport } from '@vuelume/project-analyzer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const exampleRoot = fileURLToPath(new URL('../../../examples/basic-shop', import.meta.url))

describe('analyzeProject on examples/basic-shop', () => {
  it('discovers every component and its props', async () => {
    const project = await analyzeProject(exampleRoot)
    const byName = Object.fromEntries(project.components.map((c) => [c.name, c]))

    expect(Object.keys(byName).sort()).toEqual([
      'App',
      'AppHeader',
      'Button',
      'LegacyNotice',
      'PriceTag',
      'ProductCard',
      'ProductGrid',
      'SearchInput',
      'StatusBadge',
    ])
    expect(byName.Button!.props.map((p) => `${p.name}: ${p.type.text}`)).toEqual([
      'variant: string',
      'size: "small" | "medium" | "large"',
      'disabled: boolean',
    ])
    expect(byName.ProductCard!.props.map((p) => [p.name, p.type.kind, p.default])).toEqual([
      ['title', 'string', undefined],
      ['price', 'number', undefined],
      ['featured', 'boolean', 'false'],
      ['badge', 'enum', undefined],
    ])
    expect(byName.StatusBadge!.propsComplete).toBe(false)
    expect(byName.LegacyNotice!.api).toBe('options')
  })

  it('resolves component usages to project files', async () => {
    const project = await analyzeProject(exampleRoot)
    const app = project.components.find((c) => c.name === 'App')!
    expect(app.usages.map((u) => [u.tag, u.resolution, u.resolvedFile ?? null])).toEqual([
      ['AppHeader', 'import', 'src/components/AppHeader.vue'],
      ['SearchInput', 'import', 'src/components/SearchInput.vue'],
      ['ProductCard', 'import', 'src/components/ProductCard.vue'],
      ['Button', 'import', 'src/components/Button.vue'],
      ['ProductGrid', 'import', 'src/components/ProductGrid.vue'],
      ['Transition', 'builtin', null],
      ['StatusBadge', 'import', 'src/components/StatusBadge.vue'],
      ['LegacyNotice', 'import', 'src/components/legacy/LegacyNotice.vue'],
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('lists non-Vue source files too', async () => {
    const project = await analyzeProject(exampleRoot)
    expect(project.files.filter((f) => f.kind !== 'vue').map((f) => f.file)).toEqual([
      'src/main.ts',
      'src/types.ts',
      'vite.config.ts',
    ])
  })
})

describe('analyzeProject on a temporary project', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vuelume-analyzer-'))
    const write = async (file: string, content: string) => {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), content)
    }
    await write(
      'src/App.vue',
      `<script setup>
import Card from '@/ui/Card.vue'
import Missing from './Missing.vue'
import Lib from 'some-lib'
</script>
<template><Card /><Missing /><Lib /><GlobalThing /></template>`,
    )
    await write('src/ui/Card.vue', '<template><div /></template>')
    await write('src/other/Card.vue', '<template><div /></template>')
    await write('src/Broken.vue', '<template><div></template>')
    await write('node_modules/pkg/Ignored.vue', '<template><div /></template>')
    await write('.hidden/Ignored.vue', '<template><div /></template>')
    await write('src/types.d.ts', 'export {}')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('skips ignored/hidden directories and declaration files', async () => {
    const files = await discoverSourceFiles(root)
    expect(files.map((f) => f.file)).toEqual([
      'src/App.vue',
      'src/Broken.vue',
      'src/other/Card.vue',
      'src/ui/Card.vue',
    ])
  })

  it('uses explicit aliases, reports unresolved project imports and duplicate names', async () => {
    const project = await analyzeProject(root, { aliases: { '@': 'src' } })
    const app = project.components.find((c) => c.file === 'src/App.vue')!
    expect(app.usages.map((u) => [u.tag, u.resolution, u.resolvedFile ?? null])).toEqual([
      ['Card', 'import', 'src/ui/Card.vue'],
      ['Missing', 'import', null],
      ['Lib', 'import', null],
      ['GlobalThing', 'unresolved', null],
    ])
    expect(project.diagnostics.map((d) => d.code).sort()).toEqual([
      'project/duplicate-name',
      'project/unresolved-import',
    ])
  })

  it('keeps going when a file has syntax errors', async () => {
    const project = await analyzeProject(root)
    const broken = project.components.find((c) => c.file === 'src/Broken.vue')!
    expect(broken.diagnostics.some((d) => d.code === 'sfc/parse-error')).toBe(true)
  })

  it('rejects a path that is not a directory', async () => {
    await expect(analyzeProject(path.join(root, 'nope'))).rejects.toThrow(/Not a directory/)
  })
})

describe('resolveImport', () => {
  const files = new Set(['src/a/Button.vue', 'src/utils/index.ts', 'src/types.ts'])

  it('resolves relative specifiers with and without extensions', () => {
    expect(resolveImport('src/App.vue', './a/Button.vue', files)).toBe('src/a/Button.vue')
    expect(resolveImport('src/a/Button.vue', '../types', files)).toBe('src/types.ts')
    expect(resolveImport('src/App.vue', './utils', files)).toBe('src/utils/index.ts')
  })

  it('ignores bare specifiers unless aliased', () => {
    expect(resolveImport('src/App.vue', 'vue', files)).toBeUndefined()
    expect(resolveImport('src/App.vue', '@/types', files)).toBeUndefined()
    expect(resolveImport('src/App.vue', '@/types', files, { '@': 'src' })).toBe('src/types.ts')
  })
})
