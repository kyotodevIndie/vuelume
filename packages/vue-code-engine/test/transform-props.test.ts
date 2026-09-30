import { findElementById } from '@vuelume/project-model'
import {
  analyzeComponent,
  removeProp,
  setProp,
  type TransformResult,
} from '@vuelume/vue-code-engine'
import { describe, expect, it } from 'vitest'

const sfc = (template: string, script = `import ProductCard from './ProductCard.vue'`) =>
  `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n\n<style scoped>\n.a { color: red }\n</style>\n`

function code(result: TransformResult): string {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.code
}

describe('setProp — the examples from the project brief', () => {
  it('size: large → small', () => {
    const input = sfc(`  <Button
    variant="primary"
    size="large"
  />`)
    const output = code(setProp(input, { nodeId: '0', name: 'size', value: 'small' }))
    expect(output).toBe(
      sfc(`  <Button
    variant="primary"
    size="small"
  />`),
    )
  })

  it('title: Notebook → MacBook Pro, leaving :price untouched', () => {
    const input = sfc(`<ProductCard
  title="Notebook"
  :price="4999"
/>`)
    const result = setProp(input, { nodeId: '0', name: 'title', value: 'MacBook Pro' })
    expect(code(result)).toBe(
      sfc(`<ProductCard
  title="MacBook Pro"
  :price="4999"
/>`),
    )
    // Exactly one minimal edit: the attribute value.
    expect(result.ok && result.edits).toEqual([
      {
        start: input.indexOf('"Notebook"'),
        end: input.indexOf('"Notebook"') + 10,
        text: '"MacBook Pro"',
      },
    ])
  })
})

describe('setProp — existing attributes', () => {
  it('keeps single quotes and escapes what must be escaped', () => {
    const input = sfc(`<ProductCard title='Old' />`)
    expect(code(setProp(input, { nodeId: '0', name: 'title', value: 'It\'s "new"' }))).toBe(
      sfc(`<ProductCard title='It&#39;s "new"' />`),
    )
    expect(
      code(setProp(input, { nodeId: '0', name: 'title', value: 'Tom & Jerry &amp; co' })),
    ).toBe(sfc(`<ProductCard title='Tom & Jerry &amp;amp; co' />`))
  })

  it('updates literal bindings in place, keeping the binding form', () => {
    const input = sfc(`<ProductCard :price="4999" :title="'Old'" :featured="false" />`)
    let output = code(setProp(input, { nodeId: '0', name: 'price', value: 10.5 }))
    output = code(setProp(output, { nodeId: '0', name: 'title', value: 'New "one"' }))
    output = code(setProp(output, { nodeId: '0', name: 'featured', value: true }))
    expect(output).toBe(
      sfc(`<ProductCard :price="10.5" :title="'New &quot;one&quot;'" :featured="true" />`),
    )
    expect(code(setProp(input, { nodeId: '0', name: 'price', value: -3 }))).toBe(
      sfc(`<ProductCard :price="-3" :title="'Old'" :featured="false" />`),
    )
  })

  it('turns a static attribute into a binding when the value is not a string', () => {
    const input = sfc(`<ProductCard price="10" featured />`)
    expect(code(setProp(input, { nodeId: '0', name: 'price', value: 20 }))).toBe(
      sfc(`<ProductCard :price="20" featured />`),
    )
    expect(code(setProp(input, { nodeId: '0', name: 'featured', value: false }))).toBe(
      sfc(`<ProductCard price="10" :featured="false" />`),
    )
  })

  it('matches kebab-case and camelCase spellings of the same prop', () => {
    const input = sfc(`<ProductCard is-featured="no" />`)
    expect(code(setProp(input, { nodeId: '0', name: 'isFeatured', value: 'yes' }))).toBe(
      sfc(`<ProductCard is-featured="yes" />`),
    )
  })

  it('is a no-op when the value is already set', () => {
    const input = sfc(`<ProductCard title="Same" featured :price="1" />`)
    for (const [name, value] of [
      ['title', 'Same'],
      ['featured', true],
      ['price', 1],
    ] as const) {
      const result = setProp(input, { nodeId: '0', name, value })
      expect(result).toEqual({ ok: true, code: input, changed: false, edits: [] })
    }
  })
})

describe('setProp — adding attributes follows the element layout', () => {
  it('one attribute per line → new line with the same indentation', () => {
    const input = sfc(`  <ProductCard
      title="A"
      :price="1"
  />`)
    expect(code(setProp(input, { nodeId: '0', name: 'badge', value: 'new' }))).toBe(
      sfc(`  <ProductCard
      title="A"
      :price="1"
      badge="new"
  />`),
    )
  })

  it('inline attributes → appended on the same line', () => {
    const input = sfc(`<ProductCard title="A" :price="1">content</ProductCard>`)
    expect(code(setProp(input, { nodeId: '0', name: 'featured', value: true }))).toBe(
      sfc(`<ProductCard title="A" :price="1" :featured="true">content</ProductCard>`),
    )
  })

  it('no attributes → right after the tag name', () => {
    const input = sfc(`<div>\n  <ProductCard/>\n</div>`)
    expect(code(setProp(input, { nodeId: '0.0', name: 'title', value: 'X' }))).toBe(
      sfc(`<div>\n  <ProductCard title="X"/>\n</div>`),
    )
  })

  it('preserves CRLF line endings', () => {
    const input = sfc(`<ProductCard\n  title="A"\n/>`).replace(/\n/g, '\r\n')
    const output = code(setProp(input, { nodeId: '0', name: 'badge', value: 'sale' }))
    expect(output).toBe(sfc(`<ProductCard\n  title="A"\n  badge="sale"\n/>`).replace(/\n/g, '\r\n'))
  })
})

describe('setProp — refuses anything outside the safe subset', () => {
  const cases: [string, string, string, string][] = [
    ['advanced binding', `<ProductCard :title="product.name" />`, 'title', 'advanced-binding'],
    [
      'v-bind spread (existing)',
      `<ProductCard v-bind="attrs" title="A" />`,
      'title',
      'spread-binding',
    ],
    ['v-bind spread (new)', `<ProductCard v-bind="attrs" />`, 'title', 'spread-binding'],
    ['v-model arg', `<ProductCard v-model:title="t" />`, 'title', 'model-binding'],
    ['duplicates', `<ProductCard class="a" :class="b" />`, 'class', 'duplicate'],
    ['modifiers', `<ProductCard :title.prop="'x'" />`, 'title', 'modifiers'],
  ]
  for (const [label, template, name, reason] of cases) {
    it(label, () => {
      const result = setProp(sfc(template), { nodeId: '0', name, value: 'x' })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatchObject({ code: 'readonly', reason })
    })
  }

  it('refuses files with parse errors', () => {
    const result = setProp(sfc(`<ProductCard title="A"><div></ProductCard>`), {
      nodeId: '0',
      name: 'title',
      value: 'B',
    })
    expect(!result.ok && result.error.code).toBe('parse-error')
  })

  it('refuses unknown nodes, invalid names and non-finite numbers', () => {
    const input = sfc(`<ProductCard />`)
    expect(!setProp(input, { nodeId: '3', name: 'a', value: 'b' }).ok).toBe(true)
    for (const name of [':a', '@click', 'v-if', 'is', 'key', 'a b']) {
      const result = setProp(input, { nodeId: '0', name, value: 'b' })
      expect(!result.ok && result.error.code).toBe('invalid-name')
    }
    const nan = setProp(input, { nodeId: '0', name: 'price', value: Number.NaN })
    expect(!nan.ok && nan.error.code).toBe('invalid-value')
  })
})

describe('removeProp', () => {
  it('removes a whole line in one-attribute-per-line layouts', () => {
    const input = sfc(`<ProductCard
  title="Notebook"
  :price="4999"
  featured
/>`)
    expect(code(removeProp(input, { nodeId: '0', name: 'price' }))).toBe(
      sfc(`<ProductCard
  title="Notebook"
  featured
/>`),
    )
    expect(code(removeProp(input, { nodeId: '0', name: 'featured' }))).toBe(
      sfc(`<ProductCard
  title="Notebook"
  :price="4999"
/>`),
    )
  })

  it('removes inline attributes with their separating space', () => {
    const input = sfc(`<ProductCard title="A" :price="1" featured />`)
    expect(code(removeProp(input, { nodeId: '0', name: 'price' }))).toBe(
      sfc(`<ProductCard title="A" featured />`),
    )
    expect(code(removeProp(input, { nodeId: '0', name: 'title' }))).toBe(
      sfc(`<ProductCard :price="1" featured />`),
    )
  })

  it('keeps the next attribute on its indented line', () => {
    const input = sfc(`<ProductCard\n  title="A" featured\n/>`)
    expect(code(removeProp(input, { nodeId: '0', name: 'title' }))).toBe(
      sfc(`<ProductCard\n  featured\n/>`),
    )
  })

  it('can remove advanced bindings (the whole attribute is unambiguous)', () => {
    const input = sfc(`<ProductCard :title="p.name + '!'" />`)
    expect(code(removeProp(input, { nodeId: '0', name: 'title' }))).toBe(sfc(`<ProductCard />`))
  })

  it('is a no-op for absent props and refuses ambiguous duplicates', () => {
    const input = sfc(`<ProductCard class="a" :class="b" />`)
    expect(removeProp(input, { nodeId: '0', name: 'title' })).toMatchObject({
      ok: true,
      changed: false,
    })
    const result = removeProp(input, { nodeId: '0', name: 'class' })
    expect(!result.ok && result.error.reason).toBe('duplicate')
  })
})

describe('round-trip safety', () => {
  // A deliberately messy file: comments, odd spacing, other blocks, entities, v-if/v-for.
  const messy = `<!-- leading comment -->
<script setup lang="ts">
import ProductCard from './ProductCard.vue'
const   products = [ ] // weird spacing is preserved
</script>

<template>
    <main   id="app"  >
      <ProductCard   v-if="ok"  title = "A &lt; B"   :price='1'
         />
      <p v-else>{{ products.length }}  items</p>
      <ProductCard v-for="p in products" :key="p.id" badge="x"/>
    </main>
</template>

<i18n lang="json">{ "en": { "hi": "Hello" } }</i18n>
`

  it('only the targeted bytes change', () => {
    const output = code(setProp(messy, { nodeId: '0.0', name: 'title', value: 'C' }))
    expect(output).toBe(messy.replace('title = "A &lt; B"', 'title = "C"'))
  })

  it('arbitrary string values survive a write → parse round-trip', () => {
    const samples = [
      '',
      ' ',
      'plain',
      '"double"',
      "'single'",
      `both " and '`,
      '&amp; literal entity',
      '&lt;tag&gt;',
      '<b>bold</b>',
      'line\nbreak',
      '{{ not interpolation }}',
      'emoji 🎉 ção',
      'back\\slash',
      '&',
      '&#39;',
    ]
    for (const value of samples) {
      for (const nodeId of ['0.0', '0.2']) {
        const output = code(setProp(messy, { nodeId, name: 'title', value }))
        const element = findElementById(
          analyzeComponent(output, { filename: 'x.vue' }).template!,
          nodeId,
        )!
        const attr = element.attributes.find((a) => a.kind === 'static' && a.name === 'title')
        expect(attr && attr.kind === 'static' && attr.value).toBe(value)
      }
    }
  })

  it('arbitrary string values survive round-trip inside a literal binding', () => {
    const input = sfc(`<ProductCard :title="'x'" />`)
    for (const value of [`a'b`, `a"b`, 'a\\b', 'a\nb', '&amp;', '`tpl ${x}`']) {
      const output = code(setProp(input, { nodeId: '0', name: 'title', value }))
      const attr = findElementById(analyzeComponent(output, { filename: 'x.vue' }).template!, '0')!
        .attributes[0]!
      expect(attr.kind === 'bind' && attr.literal).toEqual({ type: 'string', value })
    }
  })

  it('setProp then removeProp of a new prop restores the original file', () => {
    const added = code(setProp(messy, { nodeId: '0.0', name: 'badge', value: 'sale' }))
    expect(code(removeProp(added, { nodeId: '0.0', name: 'badge' }))).toBe(messy)
  })
})
