import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '@vuelume/cli'
import { afterEach, describe, expect, it } from 'vitest'

const exampleRoot = fileURLToPath(new URL('../../../examples/basic-shop', import.meta.url))

async function run(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('vuelume inspect', () => {
  it('prints components and props in the documented format', async () => {
    const { code, out } = await run('inspect', exampleRoot)
    expect(code).toBe(0)
    expect(out).toMatch(/^Found 9 Vue components in /)
    expect(out).toContain(
      [
        'Button  (src/components/Button.vue)',
        '  props',
        '    variant: string',
        '    size?: "small" | "medium" | "large"',
        '    disabled?: boolean',
      ].join('\n'),
    )
    expect(out).toContain('[props/imported-type]')
  })

  it('emits the full project model as JSON', async () => {
    const { code, out } = await run('inspect', exampleRoot, '--json')
    expect(code).toBe(0)
    const project = JSON.parse(out)
    expect(project.components).toHaveLength(9)
  })

  it('returns exit code 2 on usage errors', async () => {
    expect((await run('inspect')).code).toBe(2)
    expect((await run('nope')).code).toBe(2)
    expect((await run('inspect', exampleRoot, '--bogus')).code).toBe(2)
  })
})

describe('vuelume tree', () => {
  it('shows node ids, locations and editability', async () => {
    const { code, out } = await run('tree', path.join(exampleRoot, 'src/App.vue'))
    expect(code).toBe(0)
    expect(out).toMatch(/1\.2\s+<Button>\s+component @ 34:5/)
    expect(out).toMatch(/:cart-count="cart.length"\s+⚠ advanced-binding/)
  })
})

describe('vuelume set-prop / remove-prop', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  async function copyApp() {
    dir = await mkdtemp(path.join(tmpdir(), 'vuelume-cli-'))
    await cp(path.join(exampleRoot, 'src/App.vue'), path.join(dir, 'App.vue'))
    return path.join(dir, 'App.vue')
  }

  it('dry-runs by default and writes with --write', async () => {
    const file = await copyApp()
    const original = await readFile(file, 'utf8')

    const dry = await run('set-prop', file, '1.2', 'size', 'small')
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('-       size="large"')
    expect(dry.out).toContain('+       size="small"')
    expect(await readFile(file, 'utf8')).toBe(original)

    const wet = await run('set-prop', file, '1.2', 'size', 'small', '--write')
    expect(wet.code).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(original.replace('size="large"', 'size="small"'))
  })

  it('parses typed values and removes props', async () => {
    const file = await copyApp()
    const original = await readFile(file, 'utf8')
    await run('set-prop', file, '1.1', 'price', '10', '--type', 'number', '--write')
    await run('remove-prop', file, '1.1', 'badge', '--write')
    expect(await readFile(file, 'utf8')).toBe(
      original.replace(':price="4999"', ':price="10"').replace('\n      badge="new"', ''),
    )
  })

  it('reports refusals with exit code 1 and leaves the file untouched', async () => {
    const file = await copyApp()
    const original = await readFile(file, 'utf8')
    const result = await run('set-prop', file, '0', 'cartCount', '3', '--type', 'number', '--write')
    expect(result.code).toBe(1)
    expect(result.err).toContain('readonly (advanced-binding)')
    expect(await readFile(file, 'utf8')).toBe(original)
  })
})
