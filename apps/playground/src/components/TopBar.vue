<script setup lang="ts">
import { computed } from 'vue'
import { openInEditor } from '../api'
import { labelOf, redo, state, undo, type Device } from '../editor'
import Icon from './Icon.vue'

const projectName = computed(() => state.project?.root.split(/[\\/]/).pop() ?? 'vuelume')
const devices: { id: Device; icon: string; label: string; width: string }[] = [
  { id: 'desktop', icon: 'desktop', label: 'Desktop', width: '100%' },
  { id: 'tablet', icon: 'tablet', label: 'Tablet (768 px)', width: '768 px' },
  { id: 'mobile', icon: 'mobile', label: 'Mobile (390 px)', width: '390 px' },
]
const width = computed(() => devices.find((d) => d.id === state.device)!.width)
const undoTitle = computed(() =>
  state.history.undo[0] ? `Undo: ${state.history.undo[0].label} (Ctrl+Z)` : 'Nothing to undo',
)
const redoTitle = computed(() =>
  state.history.redo[0] ? `Redo: ${state.history.redo[0].label} (Ctrl+Shift+Z)` : 'Nothing to redo',
)
const savedAt = computed(() =>
  state.lastSaved?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
)

function openFile() {
  if (!state.project || !state.openFile) return
  openInEditor(state.project.root, state.openFile)
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="logo">◆</span>
      <div class="titles">
        <strong>{{ projectName }}</strong>
        <span class="crumb">
          <Icon name="file" :size="12" />
          {{ state.openFile ?? 'No file' }}
          <template v-if="state.selection"> · {{ labelOf(state.selection) }}</template>
        </span>
      </div>
    </div>

    <div class="center">
      <div class="segmented" role="group" aria-label="Preview size">
        <button
          v-for="d in devices"
          :key="d.id"
          :class="{ active: state.device === d.id }"
          :title="d.label"
          @click="state.device = d.id"
        >
          <Icon :name="d.icon" />
        </button>
      </div>
      <span class="muted size">{{ width }}</span>
      <button
        :class="['tool', { active: state.inspecting }]"
        title="Select elements in the preview (click to select, Alt+click to drill down)"
        @click="state.inspecting = !state.inspecting"
      >
        <Icon name="cursor" />
      </button>
    </div>

    <div class="right">
      <span v-if="state.busy" class="status busy">Saving…</span>
      <span v-else-if="state.changes > 0" class="status saved" :title="`Last write ${savedAt}`">
        <Icon name="check" :size="12" /> {{ state.changes }} change{{
          state.changes === 1 ? '' : 's'
        }}
        saved
      </span>
      <span v-else class="status muted">No changes</span>
      <button
        class="tool"
        :disabled="state.history.undo.length === 0"
        :title="undoTitle"
        @click="undo"
      >
        <Icon name="undo" />
      </button>
      <button
        class="tool"
        :disabled="state.history.redo.length === 0"
        :title="redoTitle"
        @click="redo"
      >
        <Icon name="redo" />
      </button>
      <button
        class="primary"
        :disabled="!state.openFile"
        title="Open the current file in your code editor"
        @click="openFile"
      >
        <Icon name="code" /> Open in code
      </button>
    </div>
  </header>
</template>
