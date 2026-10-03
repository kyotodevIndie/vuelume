<script setup lang="ts">
import type { PreviewToEditor } from '@vuelume/project-model'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import InsertDialog from './components/InsertDialog.vue'
import InspectorPanel from './components/InspectorPanel.vue'
import LayerTree from './components/LayerTree.vue'
import PalettePanel from './components/PalettePanel.vue'
import PreviewPane from './components/PreviewPane.vue'
import TopBar from './components/TopBar.vue'
import Icon from './components/Icon.vue'
import {
  dropOn,
  frame,
  handleShortcut,
  loadProject,
  post,
  refreshFiles,
  selectFromCanvas,
  state,
  syncPreview,
} from './editor'

type Tab = 'layers' | 'insert'
const tab = ref<Tab>('layers')

// Resizable side panels (widths persist per browser).
const load = (key: string, fallback: number) => {
  try {
    return Number(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}
const left = ref(load('vuelume:left', 290))
const right = ref(load('vuelume:right', 320))
const columns = computed(() => `48px ${left.value}px 4px minmax(320px, 1fr) 4px ${right.value}px`)

function startResize(side: 'left' | 'right', event: PointerEvent) {
  const startX = event.clientX
  const start = side === 'left' ? left.value : right.value
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  document.body.classList.add('resizing')
  const move = (e: PointerEvent) => {
    const delta = side === 'left' ? e.clientX - startX : startX - e.clientX
    const value = Math.min(560, Math.max(220, start + delta))
    if (side === 'left') left.value = value
    else right.value = value
  }
  const up = () => {
    document.body.classList.remove('resizing')
    target.removeEventListener('pointermove', move)
    try {
      localStorage.setItem(`vuelume:${side}`, String(side === 'left' ? left.value : right.value))
    } catch {
      /* storage unavailable: widths just reset next time */
    }
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up, { once: true })
}

function onKeydown(event: KeyboardEvent) {
  const el = event.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
  if (state.pending) return
  const handled = handleShortcut({
    key: event.key,
    mod: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
  if (handled) event.preventDefault()
}

async function onMessage(event: MessageEvent<PreviewToEditor>) {
  if (event.origin !== location.origin || event.source !== frame.value?.contentWindow) return
  const message = event.data
  switch (message?.type) {
    case 'vuelume:ready':
      syncPreview()
      if (state.openFile) await refreshFiles([state.openFile])
      break
    case 'vuelume:select':
      await selectFromCanvas(message.target)
      break
    case 'vuelume:drop': {
      const payload =
        message.mode === 'move' && message.source
          ? { kind: 'move' as const, ref: message.source }
          : state.drag
      state.drag = null
      post({ type: 'vuelume:drag', active: false })
      if (payload) await dropOn(message.target, message.position, payload)
      break
    }
    case 'vuelume:key':
      handleShortcut(message.input)
      break
    case 'vuelume:updated':
      await refreshFiles(message.files)
      break
  }
}

watch(
  () => state.inspecting,
  (enabled) => post({ type: 'vuelume:inspect', enabled }),
)

onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeydown)
  void loadProject()
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app" :style="{ gridTemplateColumns: columns }">
    <TopBar class="area-top" />

    <nav class="rail" aria-label="Panels">
      <button :class="{ active: tab === 'insert' }" title="Insert" @click="tab = 'insert'">
        <Icon name="plus" :size="18" />
      </button>
      <button :class="{ active: tab === 'layers' }" title="Layers" @click="tab = 'layers'">
        <Icon name="layers" :size="18" />
      </button>
    </nav>

    <aside class="panel left-panel">
      <div class="tabs" role="tablist">
        <button
          role="tab"
          :aria-selected="tab === 'layers'"
          :class="{ active: tab === 'layers' }"
          @click="tab = 'layers'"
        >
          Layers
        </button>
        <button
          role="tab"
          :aria-selected="tab === 'insert'"
          :class="{ active: tab === 'insert' }"
          @click="tab = 'insert'"
        >
          Insert
        </button>
      </div>
      <div class="panel-body">
        <LayerTree v-if="tab === 'layers'" />
        <PalettePanel v-else />
      </div>
    </aside>

    <div
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startResize('left', $event)"
    />
    <PreviewPane />
    <div
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="startResize('right', $event)"
    />
    <InspectorPanel />

    <div class="toasts" aria-live="polite">
      <div v-for="t in state.toasts" :key="t.id" :class="['toast', t.kind]">{{ t.text }}</div>
    </div>

    <InsertDialog v-if="state.pending" />

    <div v-if="state.loading" class="overlay">Loading project…</div>
    <div v-else-if="state.fatal" class="overlay error">{{ state.fatal }}</div>
  </div>
</template>
