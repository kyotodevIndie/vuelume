<script setup lang="ts">
import type { EditValue, PropDefinition, TemplateAttribute } from '@vuelume/project-model'
import { computed, ref, watch } from 'vue'
import { openInEditor } from '../api'
import {
  duplicateSelection,
  labelOf,
  moveSelection,
  removeSelection,
  run,
  select,
  selectedElement,
  siblingsOf,
  state,
  usedComponent,
  wrapSelection,
} from '../editor'
import ClassEditor from './ClassEditor.vue'
import Icon from './Icon.vue'
import PropField from './PropField.vue'
import StyleEditor from './StyleEditor.vue'

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const camelize = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

const element = selectedElement
const file = computed(() => state.selection?.file ?? '')
const isComponent = computed(() => element.value?.elementType === 'component')
const isNative = computed(() => element.value?.elementType === 'element')
const siblings = computed(() => (state.selection ? siblingsOf(state.selection) : {}))

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

/** Component usage: declared props first (declaration order), then extra attributes. */
const propRows = computed<Row[]>(() => {
  const el = element.value
  if (!el || !isComponent.value) return []
  const byKey = new Map<string, TemplateAttribute>()
  for (const attr of el.attributes) {
    const key = attributeKey(attr)
    if (key && key !== 'class' && key !== 'style' && !byKey.has(key)) byKey.set(key, attr)
  }
  const rows: Row[] = []
  for (const definition of usedComponent.value?.props ?? []) {
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

/** Native element: written attributes other than class/style. */
const attributeRows = computed<Row[]>(() => {
  const el = element.value
  if (!el || isComponent.value) return []
  return el.attributes
    .filter(
      (a) =>
        (a.kind === 'static' || a.kind === 'bind') &&
        attributeKey(a) &&
        !['class', 'style'].includes(attributeKey(a)!),
    )
    .map((attribute) => ({
      name: attribute.kind === 'static' ? attribute.name : (attribute as { name: string }).name,
      attribute,
    }))
})

const directives = computed(() =>
  (element.value?.attributes ?? []).filter(
    (a) => a.kind === 'on' || a.kind === 'directive' || (a.kind === 'bind' && !attributeKey(a)),
  ),
)

// Text content ------------------------------------------------------------------

const textState = computed<{ editable: boolean; value: string; reason?: string }>(() => {
  const el = element.value
  if (!el) return { editable: false, value: '' }
  if (VOID.has(el.tag.toLowerCase())) return { editable: false, value: '', reason: 'void' }
  if (
    el.attributes.some((a) => a.kind === 'directive' && (a.name === 'html' || a.name === 'text'))
  ) {
    return { editable: false, value: '', reason: 'Content comes from v-html / v-text.' }
  }
  if (el.children.some((c) => c.type !== 'text')) {
    const dynamic = el.children.some((c) => c.type === 'interpolation')
    return {
      editable: false,
      value: '',
      reason: dynamic
        ? 'Contains {{ }} interpolations — edit in code.'
        : 'Contains other elements — edit them individually.',
    }
  }
  const text = el.children
    .map((c) => (c.type === 'text' ? c.content : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return { editable: true, value: text }
})
const textDraft = ref('')
watch(textState, (s) => (textDraft.value = s.value), { immediate: true })

async function commitText() {
  if (!state.selection || textDraft.value === textState.value.value) return
  await run(
    file.value,
    { op: 'setText', nodeId: state.selection.nodeId, text: textDraft.value },
    'Text updated',
  )
}

// Props / attributes ----------------------------------------------------------------

async function setValue(name: string, value: EditValue) {
  if (state.selection)
    await run(file.value, { op: 'setProp', nodeId: state.selection.nodeId, name, value })
}
async function removeValue(name: string) {
  if (state.selection)
    await run(file.value, { op: 'removeProp', nodeId: state.selection.nodeId, name })
}

const newAttrName = ref('')
const newAttrValue = ref('')
async function addAttribute() {
  const name = newAttrName.value.trim()
  if (!name) return
  if (
    await run(file.value, {
      op: 'setProp',
      nodeId: state.selection!.nodeId,
      name,
      value: newAttrValue.value,
    })
  ) {
    newAttrName.value = ''
    newAttrValue.value = ''
  }
}

// Slots -----------------------------------------------------------------------------

const slots = computed(() => {
  const el = element.value
  const declared = usedComponent.value?.slots ?? []
  if (!el || declared.length === 0) return []
  const provided = new Set(
    el.children.flatMap((c) =>
      c.type === 'element' && c.elementType === 'template'
        ? c.attributes.flatMap((a) =>
            a.kind === 'directive' && a.name === 'slot' ? [a.arg ?? 'default'] : [],
          )
        : [],
    ),
  )
  const implicitDefault = el.children.some(
    (c) => c.type !== 'comment' && !(c.type === 'element' && c.elementType === 'template'),
  )
  return declared
    .filter((s) => s.name !== null)
    .map((s) => ({
      name: s.name!,
      provided: provided.has(s.name!) || (s.name === 'default' && implicitDefault),
    }))
})

async function addSlot(name: string) {
  const nodeId = state.selection!.nodeId
  await run(
    file.value,
    {
      op: 'insertNode',
      target: { nodeId, position: 'last-child' },
      node: { tag: 'template', slot: name },
    },
    `Added #${name} slot`,
  )
}

function open(attr?: TemplateAttribute) {
  const at = attr?.range.start ?? element.value?.range.start
  if (state.project && at) openInEditor(state.project.root, file.value, at.line, at.column)
}

function rawText(attr: TemplateAttribute): string {
  if (attr.kind === 'static')
    return attr.value === null ? attr.name : `${attr.name}="${attr.value}"`
  return `${attr.rawName}${attr.expression !== null ? `="${attr.expression}"` : ''}`
}
</script>

<template>
  <aside class="inspector panel">
    <div v-if="!element" class="inspector-empty">
      <Icon name="cursor" :size="28" />
      <p>Select an element in the preview or in the layers.</p>
      <p class="hint">
        Shortcuts: Delete · Ctrl+D duplicate · Alt+↑/↓ move · Ctrl+Z / Ctrl+Shift+Z
      </p>
    </div>

    <template v-else>
      <nav v-if="state.trail.length > 1" class="trail" aria-label="Selection path">
        <button
          v-for="item in state.trail"
          :key="item.file + item.nodeId"
          :class="{
            active: item.file === state.selection?.file && item.nodeId === state.selection?.nodeId,
          }"
          @click="select(item, state.trail)"
        >
          {{ labelOf(item) }}
        </button>
      </nav>

      <header class="inspector-head">
        <div>
          <h2>&lt;{{ element.tag }}&gt;</h2>
          <span :class="['kind-badge', element.elementType]">{{ element.elementType }}</span>
        </div>
        <a href="#" class="location" @click.prevent="open()">
          {{ file }}:{{ element.range.start.line }}
        </a>
        <div class="actions" role="toolbar" aria-label="Element actions">
          <button
            class="icon-button"
            :disabled="!siblings.previous"
            title="Move up (Alt+↑)"
            @click="moveSelection('up')"
          >
            <Icon name="up" />
          </button>
          <button
            class="icon-button"
            :disabled="!siblings.next"
            title="Move down (Alt+↓)"
            @click="moveSelection('down')"
          >
            <Icon name="down" />
          </button>
          <button class="icon-button" title="Duplicate (Ctrl+D)" @click="duplicateSelection()">
            <Icon name="copy" />
          </button>
          <button class="icon-button" title="Wrap in <div>" @click="wrapSelection('div')">
            <Icon name="wrap" />
          </button>
          <button class="icon-button danger" title="Delete (Del)" @click="removeSelection()">
            <Icon name="trash" />
          </button>
        </div>
      </header>

      <div class="notes">
        <p v-if="usedComponent" class="note">
          Component defined in <code>{{ usedComponent.file }}</code>
        </p>
        <p v-if="element.flags.includes('repeated')" class="note">
          ↻ Rendered by <code>v-for</code>: edits apply to every item.
        </p>
        <p v-if="element.flags.includes('conditional')" class="note">
          ? Rendered conditionally (<code>v-if</code>).
        </p>
        <p v-if="usedComponent && !usedComponent.propsComplete" class="note warn-text">
          ⚠ Some props of {{ usedComponent.name }} could not be analyzed (imported types or Options
          API).
        </p>
      </div>

      <section v-if="isComponent" class="section">
        <h3>Properties</h3>
        <p v-if="propRows.length === 0" class="empty">No props declared or written.</p>
        <PropField
          v-for="row in propRows"
          :key="row.name"
          :name="row.name"
          :attribute="row.attribute"
          :definition="row.definition"
          @set="setValue(row.name, $event)"
          @remove="removeValue(row.name)"
          @open="open(row.attribute)"
        />
      </section>

      <section
        v-if="element.elementType !== 'template' && textState.reason !== 'void'"
        class="section"
      >
        <h3>Content</h3>
        <textarea
          v-if="textState.editable"
          v-model="textDraft"
          rows="2"
          placeholder="Text content"
          @blur="commitText"
          @keydown.enter.exact.prevent="commitText"
        />
        <p v-else class="note">{{ textState.reason }}</p>
      </section>

      <section v-if="element.elementType !== 'template'" class="section">
        <h3>Classes</h3>
        <ClassEditor :file="file" :element="element" />
      </section>

      <section v-if="element.elementType !== 'template'" class="section">
        <h3>Style</h3>
        <StyleEditor :file="file" :element="element" />
      </section>

      <section v-if="isNative" class="section">
        <h3>Attributes</h3>
        <PropField
          v-for="row in attributeRows"
          :key="row.name"
          :name="row.name"
          :attribute="row.attribute"
          :definition="undefined"
          @set="setValue(row.name, $event)"
          @remove="removeValue(row.name)"
          @open="open(row.attribute)"
        />
        <form class="add-attribute" @submit.prevent="addAttribute">
          <input v-model="newAttrName" placeholder="name" aria-label="Attribute name" />
          <input v-model="newAttrValue" placeholder="value" aria-label="Attribute value" />
          <button class="icon-button" type="submit" title="Add attribute">
            <Icon name="plus" :size="12" />
          </button>
        </form>
      </section>

      <section v-if="slots.length" class="section">
        <h3>Slots</h3>
        <div v-for="slot in slots" :key="slot.name" class="slot-row">
          <code>#{{ slot.name }}</code>
          <span v-if="slot.provided" class="ok-text">provided</span>
          <button
            v-else-if="slot.name !== 'default'"
            class="ghost small"
            @click="addSlot(slot.name)"
          >
            Add
          </button>
          <span v-else class="muted">insert content inside</span>
        </div>
      </section>

      <section v-if="directives.length" class="section">
        <h3>Directives &amp; events</h3>
        <div v-for="attr in directives" :key="attr.range.start.offset" class="readonly-row">
          <code>{{ rawText(attr) }}</code>
          <a href="#" @click.prevent="open(attr)">Open in code</a>
        </div>
      </section>
    </template>
  </aside>
</template>
