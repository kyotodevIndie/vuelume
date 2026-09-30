<script setup lang="ts">
import type {
  ComponentModel,
  PropDefinition,
  TemplateAttribute,
  TemplateElementNode,
} from '@vuelume/project-model'
import { computed } from 'vue'
import { openInEditor, type PropValue } from '../api'
import PropField from './PropField.vue'

const props = defineProps<{
  root: string
  file: string
  element: TemplateElementNode
  usedComponent: ComponentModel | undefined
}>()

const emit = defineEmits<{
  edit: [change: { name: string; value?: PropValue; remove?: boolean }]
}>()

const camelize = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

function attributeKey(attr: TemplateAttribute): string | null {
  if (attr.kind === 'static') return camelize(attr.name)
  if (attr.kind === 'bind' && attr.name && !attr.dynamicName) return camelize(attr.name)
  return null
}

interface Row {
  name: string
  attribute?: TemplateAttribute
  definition?: PropDefinition
}

/**
 * Declared props of the used component (in declaration order), then any other attribute written
 * on the element. Directives and events are listed separately as read-only.
 */
const rows = computed<Row[]>(() => {
  const byKey = new Map<string, TemplateAttribute>()
  for (const attr of props.element.attributes) {
    const key = attributeKey(attr)
    if (key && !byKey.has(key)) byKey.set(key, attr)
  }
  const rows: Row[] = []
  for (const definition of props.usedComponent?.props ?? []) {
    const key = camelize(definition.name)
    rows.push({
      name: definition.name,
      definition,
      ...(byKey.has(key) ? { attribute: byKey.get(key)! } : {}),
    })
    byKey.delete(key)
  }
  for (const [, attribute] of byKey) {
    rows.push({
      name: attribute.kind === 'static' ? attribute.name : (attribute as { name: string }).name,
      attribute,
    })
  }
  return rows
})

const others = computed(() => props.element.attributes.filter((a) => attributeKey(a) === null))

function rawText(attr: TemplateAttribute): string {
  if (attr.kind === 'static')
    return attr.value === null ? attr.name : `${attr.name}="${attr.value}"`
  if (attr.kind === 'bind') return `${attr.rawName}="${attr.expression ?? ''}"`
  return `${attr.rawName}${attr.expression ? `="${attr.expression}"` : ''}`
}

function open(attr?: TemplateAttribute) {
  const at = attr?.range.start ?? props.element.range.start
  openInEditor(props.root, props.file, at.line, at.column)
}
</script>

<template>
  <section class="inspector">
    <h2>
      &lt;{{ element.tag }}&gt;
      <small>{{ element.elementType }}</small>
    </h2>
    <p class="location">
      <a href="#" @click.prevent="open()"
        >{{ file }}:{{ element.range.start.line }}:{{ element.range.start.column }}</a
      >
      <span v-if="usedComponent"> · defined in {{ usedComponent.file }}</span>
    </p>
    <p v-if="element.flags.includes('repeated')" class="note">
      ↻ Rendered by v-for: changes apply to every item.
    </p>
    <p v-if="element.flags.includes('conditional')" class="note">
      ? Conditionally rendered (v-if).
    </p>
    <p v-if="usedComponent && !usedComponent.propsComplete" class="note">
      ⚠ Some props of {{ usedComponent.name }} could not be analyzed.
    </p>

    <PropField
      v-for="row in rows"
      :key="row.name"
      :name="row.name"
      :attribute="row.attribute"
      :definition="row.definition"
      @set="(value) => emit('edit', { name: row.name, value })"
      @remove="emit('edit', { name: row.name, remove: true })"
      @open="open(row.attribute)"
    />

    <template v-if="others.length">
      <h3>Directives &amp; events</h3>
      <div v-for="attr in others" :key="attr.range.start.offset" class="readonly-row">
        <code>{{ rawText(attr) }}</code>
        <a href="#" @click.prevent="open(attr)">open in code</a>
      </div>
    </template>
  </section>
</template>
