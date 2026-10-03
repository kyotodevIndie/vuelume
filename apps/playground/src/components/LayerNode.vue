<script setup lang="ts">
import type { TemplateElementNode } from '@vuelume/project-model'
import { computed, nextTick, ref, watch } from 'vue'
import { dropOn, select, state, type InsertMode } from '../editor'
import Icon from './Icon.vue'

const props = defineProps<{
  file: string
  node: TemplateElementNode
  depth: number
  collapsed: Set<string>
}>()
const emit = defineEmits<{ toggle: [id: string] }>()

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
  'textarea',
])

const children = computed(() =>
  props.node.children.filter((c): c is TemplateElementNode => c.type === 'element'),
)
const textPreview = computed(() => {
  const text = props.node.children.find((c) => c.type === 'text' || c.type === 'interpolation')
  if (!text) return ''
  const value = text.type === 'text' ? text.content : `{{ ${text.expression} }}`
  return value.trim().slice(0, 24)
})
const isOpen = computed(() => !props.collapsed.has(props.node.id))
const isSelected = computed(
  () => state.selection?.file === props.file && state.selection.nodeId === props.node.id,
)
const icon = computed(() =>
  props.node.elementType === 'component'
    ? 'component'
    : props.node.elementType === 'template'
      ? 'template'
      : props.node.elementType === 'slot'
        ? 'slot'
        : 'element',
)
const hint = ref<InsertMode | null>(null)
const row = ref<HTMLElement | null>(null)

watch(isSelected, async (selected) => {
  if (!selected) return
  await nextTick()
  row.value?.scrollIntoView({ block: 'nearest' })
})

function zone(event: DragEvent): InsertMode | null {
  const drag = state.drag
  if (!drag) return null
  if (drag.kind === 'move') {
    if (drag.ref.file !== props.file) return null
    const id = drag.ref.nodeId
    if (props.node.id === id || props.node.id.startsWith(`${id}.`)) return null
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  const canContain = !VOID.has(props.node.tag.toLowerCase())
  if (canContain && ratio > 0.3 && ratio < 0.7) return 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}

function onDragStart(event: DragEvent) {
  state.drag = { kind: 'move', ref: { file: props.file, nodeId: props.node.id } }
  event.dataTransfer?.setData('text/plain', props.node.tag)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onDragOver(event: DragEvent) {
  hint.value = zone(event)
  if (hint.value) event.preventDefault()
}
async function onDrop(event: DragEvent) {
  event.preventDefault()
  const payload = state.drag
  const position = hint.value
  hint.value = null
  state.drag = null
  if (payload && position)
    await dropOn({ file: props.file, nodeId: props.node.id }, position, payload)
}
</script>

<template>
  <li>
    <div
      ref="row"
      :class="['layer', props.node.elementType, { selected: isSelected, [`drop-${hint}`]: hint }]"
      :style="{ paddingLeft: `${depth * 14 + 6}px` }"
      :title="`${file}:${node.range.start.line}:${node.range.start.column}`"
      draggable="true"
      @click="select({ file, nodeId: node.id })"
      @dragstart="onDragStart"
      @dragend="state.drag = null"
      @dragover="onDragOver"
      @dragleave="hint = null"
      @drop="onDrop"
    >
      <button
        v-if="children.length"
        :class="['twisty', { open: isOpen }]"
        :aria-label="isOpen ? 'Collapse' : 'Expand'"
        @click.stop="emit('toggle', node.id)"
      >
        <Icon name="chevron" :size="12" />
      </button>
      <span v-else class="twisty-space" />
      <Icon :name="icon" :size="13" class="kind" />
      <span class="tag">{{ node.tag }}</span>
      <span v-if="textPreview" class="text">{{ textPreview }}</span>
      <span v-for="flag in node.flags" :key="flag" class="flag" :title="flag">{{
        flag === 'repeated'
          ? 'v-for'
          : flag === 'conditional'
            ? 'v-if'
            : flag === 'slot-content'
              ? 'slot'
              : flag === 'model-binding'
                ? 'v-model'
                : flag === 'spread-binding'
                  ? 'v-bind'
                  : 'dyn'
      }}</span>
    </div>
    <ul v-if="children.length && isOpen" class="layers">
      <LayerNode
        v-for="child in children"
        :key="child.id"
        :file="file"
        :node="child"
        :depth="depth + 1"
        :collapsed="collapsed"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>
