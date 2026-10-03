import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OperationRequest } from '@vuelume/project-model'
import { applyTextEdits } from '@vuelume/vue-code-engine'
import { EditHistory, EditorService, invertEdits, version } from '@vuelume/vite-plugin'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const APP = `<script setup lang="ts">
import Card from './components/Card.vue'
</script>

<template>
  <main>
    <h1>Title</h1>
    <Card title="A" />
  </main>
</template>
`

const CARD = `<script setup lang="ts">
defineProps<{ title: string; featured?: boolean }>()
</script>

<template>
  <article>{{ title }}</article>
</template>
`

const BADGE = `<script setup lang="ts">
defineProps<{ label: string; tone?: 'info' | 'danger' }>()
</script>

<template>
  <span>{{ label }}</span>
</template>
`

let root: string
let service: EditorService

const read = (file: string) => readFile(path.join(root, file), 'utf8')
const write = async (file: string, content: string) => {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await writeFile(path.join(root, file), content)
}
async function apply(operation: OperationRequest['operation'], file = 'src/App.vue') {
  return service.apply({ file, version: version(await read(file)), operation })
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vuelume-service-'))
  await write('src/App.vue', APP)
  await write('src/components/Card.vue', CARD)
  await write('src/components/Badge.vue', BADGE)
  service = new EditorService(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('EditorService operations', () => {
  it('applies an operation, writes the file and returns the new snapshot and selection', async () => {
    const result = await apply({
      op: 'insertNode',
      target: { nodeId: '0.0', position: 'after' },
      node: { tag: 'p', text: 'Hi' },
    })
    expect(result.ok && result.nodeId).toBe('0.1')
    expect(await read('src/App.vue')).toContain('<h1>Title</h1>\n    <p>Hi</p>')
    expect(result.ok && result.history.undo.map((h) => h.label)).toEqual(['Insert <p>'])
  })

  it('rejects stale versions with 409 and invalid operations with 422, writing nothing', async () => {
    const stale = await service.apply({
      file: 'src/App.vue',
      version: 'old',
      operation: { op: 'removeNode', nodeId: '0.0' },
    })
    expect(!stale.ok && stale.status).toBe(409)
    const invalid = await apply({
      op: 'insertNode',
      target: { nodeId: null, position: 'before' },
      node: { tag: 'p' },
    })
    expect(!invalid.ok && invalid.status).toBe(422)
    expect(await read('src/App.vue')).toBe(APP)
  })

  it('refuses paths outside the project or not .vue', async () => {
    for (const file of ['../x.vue', 'src/main.ts', 'C:/abs.vue', '/abs.vue']) {
      const result = await service.apply({
        file,
        version: '',
        operation: { op: 'removeNode', nodeId: '0' },
      })
      expect(result.ok).toBe(false)
    }
  })

  it('inserts a project component with its import and refuses missing required props', async () => {
    const missing = await apply({
      op: 'insertNode',
      target: { nodeId: '0', position: 'last-child' },
      node: { tag: 'Badge' },
      component: { file: 'src/components/Badge.vue' },
    })
    expect(!missing.ok && missing.error.code).toBe('missing-required-props')

    const inserted = await apply({
      op: 'insertNode',
      target: { nodeId: '0', position: 'last-child' },
      node: { tag: 'Badge', attributes: [{ name: 'label', value: 'New' }] },
      component: { file: 'src/components/Badge.vue' },
    })
    expect(inserted.ok).toBe(true)
    const code = await read('src/App.vue')
    expect(code).toContain(
      `import Card from './components/Card.vue'\nimport Badge from './components/Badge.vue'`,
    )
    expect(code).toContain('<Card title="A" />\n    <Badge label="New" />')
  })

  it('reuses an existing import of the same component', async () => {
    const result = await apply({
      op: 'insertNode',
      target: { nodeId: '0', position: 'last-child' },
      node: { tag: 'X', attributes: [{ name: 'title', value: 'B' }] },
      component: { file: 'src/components/Card.vue' },
    })
    expect(result.ok).toBe(true)
    const code = await read('src/App.vue')
    expect(code.match(/import Card/g)).toHaveLength(1)
    expect(code).toContain('<Card title="B" />')
  })

  it('refuses inserting a component into itself', async () => {
    const result = await apply(
      {
        op: 'insertNode',
        target: { nodeId: '0', position: 'last-child' },
        node: { tag: 'Card', attributes: [{ name: 'title', value: 'x' }] },
        component: { file: 'src/components/Card.vue' },
      },
      'src/components/Card.vue',
    )
    expect(!result.ok && result.error.code).toBe('recursive')
  })
})

describe('EditorService slot checks', () => {
  it('refuses content inside a project component that renders no default slot', async () => {
    const result = await apply({
      op: 'insertNode',
      target: { nodeId: '0.1', position: 'last-child' },
      node: { tag: 'p' },
    })
    expect(!result.ok && result.error.code).toBe('no-such-slot')
    const named = await apply({
      op: 'insertNode',
      target: { nodeId: '0.1', position: 'last-child' },
      node: { tag: 'template', slot: 'footer' },
    })
    expect(!named.ok && named.error.message).toMatch(/no "footer" slot/)
  })

  it('allows it when the component declares the slot', async () => {
    await write(
      'src/components/Card.vue',
      CARD.replace('<article>{{ title }}</article>', '<article>{{ title }}<slot /></article>'),
    )
    const result = await apply({
      op: 'insertNode',
      target: { nodeId: '0.1', position: 'last-child' },
      node: { tag: 'p' },
    })
    expect(result.ok).toBe(true)
  })
})

describe('EditorService undo/redo', () => {
  it('undoes and redoes structural and prop edits exactly, restoring selection', async () => {
    await service.apply({
      file: 'src/App.vue',
      version: version(APP),
      operation: { op: 'setProp', nodeId: '0.1', name: 'title', value: 'B' },
      selection: '0.1',
    })
    const afterSet = await read('src/App.vue')
    await apply({ op: 'moveNode', nodeId: '0.1', target: { nodeId: '0.0', position: 'before' } })
    const afterMove = await read('src/App.vue')

    const undo1 = await service.undo()
    expect(await read('src/App.vue')).toBe(afterSet)
    expect(undo1.ok && undo1.history.redo.map((h) => h.label)).toEqual(['Move <Card>'])
    const undo2 = await service.undo()
    expect(await read('src/App.vue')).toBe(APP)
    expect(undo2.ok && undo2.nodeId).toBe('0.1')

    await service.redo()
    await service.redo()
    expect(await read('src/App.vue')).toBe(afterMove)
    const empty = await service.redo()
    expect(!empty.ok && empty.error.code).toBe('empty')
  })

  it('a new operation clears the redo stack', async () => {
    await apply({ op: 'removeNode', nodeId: '0.0' })
    await service.undo()
    await apply({ op: 'duplicateNode', nodeId: '0.0' })
    expect(service.history.state().redo).toEqual([])
  })

  it('never replays history over a file changed outside the editor', async () => {
    await apply({ op: 'removeNode', nodeId: '0.0' })
    await apply(
      { op: 'insertNode', target: { nodeId: '0', position: 'last-child' }, node: { tag: 'span' } },
      'src/components/Card.vue',
    )
    // Simulate an edit made in another editor.
    const external = (await read('src/App.vue')).replace('<main>', '<main id="x">')
    await write('src/App.vue', external)

    const undoCard = await service.undo()
    expect(undoCard.ok).toBe(true) // Card.vue is untouched by the external change
    const undoApp = await service.undo()
    expect(!undoApp.ok && undoApp.error.code).toBe('stale-history')
    expect(await read('src/App.vue')).toBe(external)
    expect(service.history.state().undo.some((h) => h.file === 'src/App.vue')).toBe(false)
  })
})

describe('history primitives', () => {
  it('invertEdits restores the original text', () => {
    const source = 'abcdefghij'
    const edits = [
      { start: 1, end: 3, text: 'XYZW' },
      { start: 5, end: 5, text: '__' },
      { start: 8, end: 10, text: '' },
    ]
    const changed = applyTextEdits(source, edits)
    expect(applyTextEdits(changed, invertEdits(source, edits))).toBe(source)
  })

  it('keeps a bounded, most-recent-first state', () => {
    const history = new EditHistory(2)
    for (const label of ['a', 'b', 'c']) {
      history.record({
        file: 'f.vue',
        label,
        before: '',
        after: '',
        edits: [],
        inverse: [],
        selectionBefore: null,
        selectionAfter: null,
      })
    }
    expect(history.state().undo.map((h) => h.label)).toEqual(['c', 'b'])
  })
})
