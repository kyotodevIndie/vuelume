import { analyzeComponent } from '@vuelume/vue-code-engine'
import { fileHash, hasSingleRootElement, instrumentSfc } from '@vuelume/vite-plugin'
import { describe, expect, it } from 'vitest'

const SOURCE = `<script setup>
import Card from './Card.vue'
import Multi from './Multi.vue'
</script>

<template>
  <main class="page">
    <Card title="A" />
    <Multi />
    <template v-if="ok"><p>x</p></template>
    <Transition><span /></Transition>
    <slot />
  </main>
</template>
`

describe('instrumentSfc', () => {
  const result = instrumentSfc(SOURCE, {
    file: 'src/App.vue',
    markUsage: (usage) => usage.tag !== 'Multi',
  })!

  it('marks native elements with their authoring locator', () => {
    expect(result.code).toContain('<main data-vl="src/App.vue:0" class="page">')
    expect(result.code).toContain('<p data-vl="src/App.vue:0.2.0">')
    expect(result.code).toContain('<span data-vl="src/App.vue:0.3.0" />')
  })

  it('marks component usages with a per-file attribute, except skipped ones', () => {
    const attr = `data-vl-u-${fileHash('src/App.vue')}`
    expect(result.code).toContain(`<Card ${attr}="src/App.vue:0.0" title="A" />`)
    expect(result.code).toContain('<Multi />')
    expect(result.code).toContain('<Transition>')
    expect(result.code).toContain('<template v-if="ok">')
    expect(result.code).toContain('<slot />')
  })

  it('only inserts text (line numbers are preserved) and returns a source map', () => {
    expect(result.code.split('\n')).toHaveLength(SOURCE.split('\n').length)
    expect(result.map.mappings.length).toBeGreaterThan(0)
  })

  it('skips files it cannot analyze safely', () => {
    expect(instrumentSfc('<template><div></template>', { file: 'x.vue' })).toBeNull()
    expect(instrumentSfc('<script setup>const a = 1</script>', { file: 'x.vue' })).toBeNull()
  })
})

describe('hasSingleRootElement', () => {
  const single = (template: string) =>
    hasSingleRootElement(analyzeComponent(template, { filename: 'x.vue' }))
  it('detects whether attributes can fall through to one root', () => {
    expect(single('<template><!-- c --><div /></template>')).toBe(true)
    expect(single('<template><div /><div /></template>')).toBe(false)
    expect(single('<template><slot /></template>')).toBe(false)
    expect(single('<template>text</template>')).toBe(false)
  })
})
