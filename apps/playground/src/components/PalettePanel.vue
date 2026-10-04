<script setup lang="ts">
import { computed, ref } from 'vue'
import { components, insertAtSelection, labelOf, post, state, type InsertMode } from '../editor'
import { componentItems, HTML_ITEMS, type PaletteItem } from '../palette'
import { setDragGhost } from '../dragGhost'
import Icon from './Icon.vue'

const query = ref('')
const draggingId = ref<string | null>(null)
const modes: { id: InsertMode; label: string }[] = [
  { id: 'before', label: 'Before' },
  { id: 'after', label: 'After' },
  { id: 'inside', label: 'Inside' },
]

const matches = (item: PaletteItem) => {
  const q = query.value.trim().toLowerCase()
  return !q || item.label.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q)
}
const projectItems = computed(() =>
  componentItems(components.value, state.openFile).filter(matches),
)
const htmlItems = computed(() => HTML_ITEMS.filter(matches))
const where = computed(() =>
  state.selection
    ? `${modes.find((m) => m.id === state.insertMode)!.label.toLowerCase()} ${labelOf(state.selection)}`
    : `at the end of ${state.openFile ?? 'the file'}`,
)

function onDragStart(event: DragEvent, item: PaletteItem) {
  if (item.disabled) {
    event.preventDefault()
    return
  }
  state.drag = { kind: 'insert', item }
  draggingId.value = item.id
  event.dataTransfer?.setData('text/plain', item.label)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  setDragGhost(event, `<${item.label}>`, item.kind === 'component' ? 'component' : 'element')
  post({ type: 'vuelume:drag', active: true })
}
function onDragEnd() {
  state.drag = null
  draggingId.value = null
  post({ type: 'vuelume:drag', active: false })
}
</script>

<template>
  <div class="palette">
    <div class="search">
      <Icon name="search" :size="14" />
      <input
        v-model="query"
        type="search"
        placeholder="Search components and elements"
        aria-label="Search"
      />
    </div>

    <div class="insert-mode">
      <span class="field-label">Insert</span>
      <div class="segmented small">
        <button
          v-for="m in modes"
          :key="m.id"
          :class="{ active: state.insertMode === m.id }"
          :disabled="!state.selection"
          @click="state.insertMode = m.id"
        >
          {{ m.label }}
        </button>
      </div>
      <p class="hint">Click to insert {{ where }}, or drag onto the preview or the layers.</p>
    </div>

    <section>
      <h3>
        Project components <span class="count">{{ projectItems.length }}</span>
      </h3>
      <p v-if="projectItems.length === 0" class="empty">No matching components.</p>
      <div class="grid">
        <button
          v-for="item in projectItems"
          :key="item.id"
          :class="['tile', { disabled: !!item.disabled, dragging: draggingId === item.id }]"
          :title="
            item.disabled ??
            item.warning ??
            `${item.detail}${item.required.length ? ` — requires ${item.required.map((p) => p.name).join(', ')}` : ''}`
          "
          draggable="true"
          @click="insertAtSelection(item)"
          @dragstart="onDragStart($event, item)"
          @dragend="onDragEnd"
        >
          <Icon name="component" :size="20" />
          <span class="name">{{ item.label }}</span>
          <span v-if="item.disabled" class="badge warn">manual</span>
          <span v-else-if="item.warning" class="badge warn">?</span>
          <span v-else-if="item.required.length" class="badge"
            >{{ item.required.length }} req.</span
          >
        </button>
      </div>
    </section>

    <section>
      <h3>
        HTML elements <span class="count">{{ htmlItems.length }}</span>
      </h3>
      <div class="grid">
        <button
          v-for="item in htmlItems"
          :key="item.id"
          :class="['tile', { dragging: draggingId === item.id }]"
          :title="item.detail"
          draggable="true"
          @click="insertAtSelection(item)"
          @dragstart="onDragStart($event, item)"
          @dragend="onDragEnd"
        >
          <span class="html-tag">&lt;{{ item.label }}&gt;</span>
          <span class="name">{{ item.detail }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
