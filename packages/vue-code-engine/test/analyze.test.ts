import { findElementAtOffset, findElementById } from '@vuelume/project-model'
import { analyzeComponent } from '@vuelume/vue-code-engine'
import { describe, expect, it } from 'vitest'

const analyze = (source: string, filename = 'src/components/Test.vue') =>
  analyzeComponent(source, { filename })

describe('props: type-based defineProps', () => {
  it('reads an inline type literal, keeping the author type text', () => {
    const model = analyze(`<script setup lang="ts">
defineProps<{
  variant: string
  size?: "small" | "medium" | "large"
  disabled?: boolean
  count: number
  items: string[]
  onPick?: (id: number) => void
}>()
</script>`)
    expect(model.api).toBe('script-setup')
    expect(model.propsComplete).toBe(true)
    expect(model.props.map((p) => [p.name, p.type.text, p.type.kind, p.required])).toEqual([
      ['variant', 'string', 'string', true],
      ['size', '"small" | "medium" | "large"', 'enum', false],
      ['disabled', 'boolean', 'boolean', false],
      ['count', 'number', 'number', true],
      ['items', 'string[]', 'array', true],
      ['onPick', '(id: number) => void', 'function', false],
    ])
    expect(model.props[1]!.type.options).toEqual(['small', 'medium', 'large'])
  })

  it('resolves local interfaces, type aliases, extends and intersections', () => {
    const model = analyze(`<script setup lang="ts">
type Size = 'sm' | 'lg'
interface Base { id: string }
interface Props extends Base { size: Size; label?: string | null }
type Extra = { featured: boolean }
defineProps<Props & Extra>()
</script>`)
    expect(model.propsComplete).toBe(true)
    expect(model.props.map((p) => [p.name, p.type.text, p.type.kind])).toEqual([
      ['id', 'string', 'string'],
      ['size', 'Size', 'enum'],
      ['label', 'string | null', 'string'],
      ['featured', 'boolean', 'boolean'],
    ])
    expect(model.props[1]!.type.options).toEqual(['sm', 'lg'])
  })

  it('keeps unresolved named types as references', () => {
    const model = analyze(`<script setup lang="ts">
import type { Product } from '../types'
defineProps<{ product: Product; tags: Array<string> }>()
</script>`)
    expect(model.props.map((p) => [p.name, p.type.text, p.type.kind])).toEqual([
      ['product', 'Product', 'reference'],
      ['tags', 'Array<string>', 'array'],
    ])
  })

  it('reports (instead of guessing) props typed with an imported interface', () => {
    const model = analyze(`<script setup lang="ts">
import type { ButtonProps } from './types'
defineProps<ButtonProps>()
</script>`)
    expect(model.props).toEqual([])
    expect(model.propsComplete).toBe(false)
    expect(model.diagnostics.map((d) => d.code)).toContain('props/imported-type')
  })

  it('reads defaults from withDefaults and from reactive destructuring', () => {
    const a = analyze(`<script setup lang="ts">
withDefaults(defineProps<{ size?: string; tags?: string[] }>(), { size: 'md', tags: () => [] })
</script>`)
    expect(a.props.map((p) => [p.name, p.default])).toEqual([
      ['size', "'md'"],
      ['tags', '() => []'],
    ])

    const b = analyze(`<script setup lang="ts">
const { size = 'medium', label } = defineProps<{ size?: string; label: string }>()
</script>`)
    expect(b.props.map((p) => [p.name, p.default])).toEqual([
      ['size', "'medium'"],
      ['label', undefined],
    ])
  })
})

describe('props: runtime defineProps', () => {
  it('reads object syntax including PropType casts', () => {
    const model = analyze(`<script setup lang="ts">
import type { PropType } from 'vue'
defineProps({
  title: String,
  price: { type: Number, required: true },
  tone: { type: String as PropType<'info' | 'danger'>, default: 'info' },
  value: [String, Number],
})
</script>`)
    expect(
      model.props.map((p) => [p.name, p.type.text, p.type.kind, p.required, p.default]),
    ).toEqual([
      ['title', 'string', 'string', false, undefined],
      ['price', 'number', 'number', true, undefined],
      ['tone', "'info' | 'danger'", 'enum', false, "'info'"],
      ['value', 'string | number', 'union', false, undefined],
    ])
  })

  it('reads array syntax in plain JS', () => {
    const model = analyze(`<script setup>
defineProps(['a', 'b'])
</script>`)
    expect(model.scriptLang).toBe('js')
    expect(model.props.map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('marks dynamic definitions as incomplete', () => {
    const model = analyze(`<script setup>
const shared = { a: String }
defineProps(shared)
</script>`)
    expect(model.propsComplete).toBe(false)
    expect(model.diagnostics.map((d) => d.code)).toContain('props/unsupported-definition')
  })
})

describe('emits, models, options', () => {
  it('reads emits in call-signature, named-tuple and runtime forms', () => {
    const calls = analyze(`<script setup lang="ts">
defineEmits<{ (e: 'change', id: number): void; (e: 'open' | 'close'): void }>()
</script>`)
    expect(calls.emits.map((e) => [e.name, e.payload])).toEqual([
      ['change', 'id: number'],
      ['open', undefined],
      ['close', undefined],
    ])

    const tuples = analyze(`<script setup lang="ts">
defineEmits<{ select: [id: number]; clear: [] }>()
</script>`)
    expect(tuples.emits.map((e) => [e.name, e.payload])).toEqual([
      ['select', 'id: number'],
      ['clear', undefined],
    ])

    const runtime = analyze(`<script setup>
defineEmits(['save', 'cancel'])
</script>`)
    expect(runtime.emits.map((e) => e.name)).toEqual(['save', 'cancel'])
  })

  it('treats defineModel as a prop plus an update event', () => {
    const model = analyze(`<script setup lang="ts">
const value = defineModel<string>({ required: true })
const open = defineModel<boolean>('open')
</script>`)
    expect(model.props.map((p) => [p.name, p.type.text, p.required])).toEqual([
      ['modelValue', 'string', true],
      ['open', 'boolean', false],
    ])
    expect(model.emits.map((e) => e.name)).toEqual(['update:modelValue', 'update:open'])
  })

  it('uses defineOptions name, otherwise the file name', () => {
    expect(analyze(`<script setup>defineOptions({ name: 'FancyButton' })</script>`).name).toBe(
      'FancyButton',
    )
    expect(analyze('<template><div /></template>', 'src/views/cart/index.vue').name).toBe('Cart')
    expect(analyze('<template><div /></template>', 'src/product-card.vue').name).toBe('ProductCard')
  })

  it('detects the Options API without pretending to analyze it', () => {
    const model = analyze(`<script>
export default { name: 'Legacy', props: { a: String } }
</script>`)
    expect(model.api).toBe('options')
    expect(model.name).toBe('Legacy')
    expect(model.propsComplete).toBe(false)
    expect(model.diagnostics.map((d) => d.code)).toContain('component/options-api')
  })

  it('reports script syntax errors without throwing', () => {
    const model = analyze(`<script setup lang="ts">
const = 1
</script>
<template><div /></template>`)
    expect(model.diagnostics.map((d) => d.code)).toContain('script/parse-error')
    expect(model.template?.children).toHaveLength(1)
  })
})

describe('imports and component usages', () => {
  const source = `<script setup lang="ts">
import ProductCard from './ProductCard.vue'
import { BaseButton as Btn } from './ui'
import type { Product } from '../types'
import * as Icons from './icons'
const Local = { render: () => null }
</script>

<template>
  <section>
    <ProductCard title="A" />
    <product-card title="B" />
    <Btn />
    <Icons.Star />
    <Local />
    <Transition><div /></Transition>
    <RouterLink to="/" />
  </section>
</template>`
  const model = analyze(source)

  it('lists imports with their specifiers', () => {
    expect(
      model.imports.map((i) => [i.source, i.typeOnly, i.specifiers.map((s) => s.local)]),
    ).toEqual([
      ['./ProductCard.vue', false, ['ProductCard']],
      ['./ui', false, ['Btn']],
      ['../types', true, ['Product']],
      ['./icons', false, ['Icons']],
    ])
  })

  it('resolves template tags through script setup bindings', () => {
    expect(model.usages.map((u) => [u.tag, u.resolution, u.importSource])).toEqual([
      ['ProductCard', 'import', './ProductCard.vue'],
      ['product-card', 'import', './ProductCard.vue'],
      ['Btn', 'import', './ui'],
      ['Icons.Star', 'import', './icons'],
      ['Local', 'local', undefined],
      ['Transition', 'builtin', undefined],
      ['RouterLink', 'unresolved', undefined],
    ])
  })
})

describe('template model', () => {
  const source = `<script setup lang="ts">
import ProductCard from './ProductCard.vue'
</script>

<template>
  <div class="grid">
    <!-- products -->
    <ProductCard
      title="Note &amp; book"
      :price="4999"
      featured
      @click="select"
    />
    <ProductCard v-for="p in products" :key="p.id" :title="p.name" />
    <component :is="current" v-bind="attrs" />
    <slot name="footer" />
    <slot />
    {{ total }}
  </div>
</template>
`
  const model = analyze(source)
  const template = model.template!

  it('assigns path ids to elements and keeps exact source ranges', () => {
    const card = findElementById(template, '0.0')!
    expect(card.tag).toBe('ProductCard')
    expect(card.elementType).toBe('component')
    expect(card.selfClosing).toBe(true)
    expect(source.slice(card.range.start.offset, card.range.end.offset)).toMatch(
      /^<ProductCard[\s\S]*\/>$/,
    )
    expect(card.range.start.line).toBe(8)
    expect(card.range.start.column).toBe(5)
  })

  it('represents static attributes, literal bindings and events', () => {
    const [title, price, featured, click] = findElementById(template, '0.0')!.attributes
    expect(title).toMatchObject({
      kind: 'static',
      name: 'title',
      value: 'Note & book',
      quote: '"',
      editable: true,
    })
    expect(source.slice(title!.range.start.offset, title!.range.end.offset)).toBe(
      'title="Note &amp; book"',
    )
    expect(price).toMatchObject({
      kind: 'bind',
      name: 'price',
      literal: { type: 'number', value: 4999 },
      editable: true,
    })
    expect(featured).toMatchObject({
      kind: 'static',
      name: 'featured',
      value: null,
      editable: true,
    })
    expect(click).toMatchObject({ kind: 'on', event: 'click', editable: false })
  })

  it('classifies unsupported constructs as read-only with a reason', () => {
    const repeated = findElementById(template, '0.1')!
    expect(repeated.flags).toEqual(['repeated'])
    const title = repeated.attributes.find((a) => a.kind === 'bind' && a.name === 'title')
    expect(title).toMatchObject({ editable: false, readonlyReason: 'advanced-binding' })

    const dynamic = findElementById(template, '0.2')!
    expect(dynamic.flags).toEqual(expect.arrayContaining(['dynamic-component', 'spread-binding']))
  })

  it('collects slot outlets', () => {
    expect(model.slots).toEqual([
      { name: 'footer', nodeId: '0.3' },
      { name: 'default', nodeId: '0.4' },
    ])
  })

  it('maps source offsets back to nodes', () => {
    const offset = source.indexOf(':price')
    expect(findElementAtOffset(template, offset)?.id).toBe('0.0')
    expect(findElementAtOffset(template, source.indexOf('{{ total }}'))?.id).toBe('0')
    expect(findElementAtOffset(template, 0)).toBeUndefined()
  })

  it('is JSON-serializable', () => {
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  it('reports non-HTML templates as unsupported', () => {
    const pug = analyze(`<template lang="pug">div</template>`)
    expect(pug.template).toBeNull()
    expect(pug.diagnostics.map((d) => d.code)).toEqual(['template/unsupported-lang'])
  })
})
