<script setup lang="ts">
import type { TemplateElementNode } from '@vuelume/project-model'
import { computed, reactive, ref, watch } from 'vue'
import { components, dropAt, openFile, state } from '../editor'
import LayerNode from './LayerNode.vue'

const snapshot = computed(() => (state.openFile ? state.snapshots.get(state.openFile) : undefined))
const roots = computed(() =>
  (snapshot.value?.model.template?.children ?? []).filter(
    (c): c is TemplateElementNode => c.type === 'element',
  ),
)
const collapsed = reactive(new Set<string>())
const rootHint = ref(false)

function toggle(id: string) {
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
}

// Reveal the selection: expand its ancestors.
watch(
  () => state.selection,
  (selection) => {
    if (!selection) return
    const parts = selection.nodeId.split('.')
    for (let i = 1; i < parts.length; i++) collapsed.delete(parts.slice(0, i).join('.'))
  },
)
watch(
  () => state.openFile,
  () => collapsed.clear(),
)

async function dropAtEnd(event: DragEvent) {
  event.preventDefault()
  rootHint.value = false
  const payload = state.drag
  state.drag = null
  if (payload && state.openFile) {
    await dropAt(state.openFile, { nodeId: null, position: 'last-child' }, payload)
  }
}
</script>

<template>
  <div class="layer-tree">
    <label class="field-label" for="file-picker">Component</label>
    <select
      id="file-picker"
      :value="state.openFile ?? ''"
      class="select"
      @change="openFile(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="c in components" :key="c.file" :value="c.file">
        {{ c.name }} — {{ c.file }}
      </option>
    </select>

    <p v-if="!snapshot" class="empty">Loading…</p>
    <p v-else-if="!snapshot.model.template" class="empty">
      This component has no analyzable template.
    </p>
    <template v-else>
      <ul class="layers root">
        <LayerNode
          v-for="node in roots"
          :key="node.id"
          :file="state.openFile!"
          :node="node"
          :depth="0"
          :collapsed="collapsed"
          @toggle="toggle"
        />
      </ul>
      <div
        :class="['root-drop', { active: rootHint, visible: !!state.drag }]"
        @dragover.prevent="rootHint = true"
        @dragleave="rootHint = false"
        @drop="dropAtEnd"
      >
        Drop at the end of the template
      </div>
      <p class="hint">
        Drag layers to reorder. Drop on the top/bottom edge to place before/after, in the middle to
        nest inside.
      </p>
    </template>
  </div>
</template>
