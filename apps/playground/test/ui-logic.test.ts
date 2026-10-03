import type { ComponentModel, PropDefinition } from '@vuelume/project-model'
import { describe, expect, it } from 'vitest'
import { parseDeclarations, serializeDeclarations } from '../src/css'
import { componentItems, HTML_ITEMS, initialValue } from '../src/palette'

const range = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } }
const prop = (
  name: string,
  kind: PropDefinition['type']['kind'],
  required: boolean,
  extra: Partial<PropDefinition> = {},
): PropDefinition => ({
  name,
  type: { text: kind, kind, ...(kind === 'enum' ? { options: ['a', 'b'] } : {}) },
  required,
  range,
  ...extra,
})
const component = (
  name: string,
  file: string,
  props: PropDefinition[],
  extra: Partial<ComponentModel> = {},
): ComponentModel => ({
  file,
  name,
  api: 'script-setup',
  props,
  propsComplete: true,
  emits: [],
  slots: [],
  imports: [],
  template: { lang: 'html', range, children: [] },
  usages: [],
  diagnostics: [],
  ...extra,
})

describe('palette', () => {
  const items = componentItems(
    [
      component('Card', 'src/Card.vue', [
        prop('title', 'string', true),
        prop('size', 'enum', true, { default: "'a'" }),
      ]),
      component('Grid', 'src/Grid.vue', [prop('items', 'array', true)]),
      component('App', 'src/App.vue', []),
      component('Badge', 'src/Badge.vue', [], { propsComplete: false }),
    ],
    'src/App.vue',
  )
  const byName = Object.fromEntries(items.map((i) => [i.label, i]))

  it('asks only for required props without defaults', () => {
    expect(byName.Card!.required.map((p) => p.name)).toEqual(['title'])
    expect(byName.Card!.disabled).toBeUndefined()
  })

  it('never invents values that cannot be typed, nor recursive insertions', () => {
    expect(byName.Grid!.disabled).toMatch(/cannot be entered visually/)
    expect(byName.App!.disabled).toMatch(/into itself/)
  })

  it('flags components whose props could not be analyzed', () => {
    expect(byName.Badge!.warning).toMatch(/could not be fully analyzed/)
  })

  it('offers common HTML elements with sensible defaults', () => {
    expect(HTML_ITEMS.find((i) => i.label === 'button')!.spec).toEqual({
      tag: 'button',
      text: 'Button',
      attributes: [{ name: 'type', value: 'button' }],
    })
    expect(initialValue(prop('n', 'number', true))).toBe(0)
    expect(initialValue(prop('e', 'enum', true))).toBe('a')
  })
})

describe('inline style declarations', () => {
  it('parses and serializes, keeping semicolons inside url() and quotes', () => {
    const parsed = parseDeclarations(
      'color: red; background: url(\'a;b.png\') no-repeat;font-family: "A;B"',
    )
    expect(parsed).toEqual([
      ['color', 'red'],
      ['background', "url('a;b.png') no-repeat"],
      ['font-family', '"A;B"'],
    ])
    expect(serializeDeclarations([...parsed, ['margin', '']])).toBe(
      'color: red; background: url(\'a;b.png\') no-repeat; font-family: "A;B"',
    )
  })
})
