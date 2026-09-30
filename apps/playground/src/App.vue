<script setup lang="ts">
import type {
  CanvasTarget,
  ComponentModel,
  EditorToPreview,
  NodeRef,
  PreviewToEditor,
  ProjectModel,
} from '@vuelume/project-model'
import { findElementById } from '@vuelume/project-model'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, type ComponentSnapshot, type PropValue } from './api'
import InspectorPanel from './components/InspectorPanel.vue'
import TemplateTree from './components/TemplateTree.vue'

const project = ref<ProjectModel | null>(null)
const snapshots = reactive(new Map<string, ComponentSnapshot>())
const openFile = ref<string | null>(null)
const selection = ref<NodeRef | null>(null)
/** Breadcrumb from the last canvas click, outermost first. */
const trail = ref<NodeRef[]>([])
const inspecting = ref(true)
const status = ref<{ kind: 'info' | 'error'; text: string } | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)

const components = computed(() =>
  [...(project.value?.components ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
)
const byFile = computed(
  () => new Map((project.value?.components ?? []).map((c) => [c.file, c] as const)),
)

const selectedSnapshot = computed(() =>
  selection.value ? snapshots.get(selection.value.file) : undefined,
)
const selectedElement = computed(() => {
  const template = selectedSnapshot.value?.model.template
  return template && selection.value ? findElementById(template, selection.value.nodeId) : undefined
})
/** For a component usage: the used component's definition (to list its declared props). */
const usedComponent = computed<ComponentModel | undefined>(() => {
  const model = selectedSnapshot.value?.model
  const usage = model?.usages.find((u) => u.nodeId === selection.value?.nodeId)
  return usage?.resolvedFile ? byFile.value.get(usage.resolvedFile) : undefined
})

async function load(file: string, force = false): Promise<ComponentSnapshot | undefined> {
  if (!force && snapshots.has(file)) return snapshots.get(file)
  try {
    const snapshot = await api.component(file)
    snapshots.set(file, snapshot)
    return snapshot
  } catch (error) {
    status.value = { kind: 'error', text: String(error) }
  }
}

async function select(ref: NodeRef | null, fromCanvas = false) {
  selection.value = ref
  if (!fromCanvas) trail.value = ref ? [ref] : []
  if (ref) {
    openFile.value = ref.file
    await load(ref.file, true)
  }
  post({ type: 'vuelume:highlight', target: ref })
}

function post(message: EditorToPreview) {
  // Reactive proxies cannot be structured-cloned: send a plain copy.
  const plain = JSON.parse(JSON.stringify(message)) as EditorToPreview
  frame.value?.contentWindow?.postMessage(plain, location.origin)
}

function nodeLabel(ref: NodeRef): string {
  const template = snapshots.get(ref.file)?.model.template
  const el = template ? findElementById(template, ref.nodeId) : undefined
  return `<${el?.tag ?? '?'}> ${ref.file.split('/').pop()}`
}

async function edit(change: { name: string; value?: PropValue; remove?: boolean }) {
  const target = selection.value
  const snapshot = selectedSnapshot.value
  if (!target || !snapshot) return
  const base = {
    file: target.file,
    nodeId: target.nodeId,
    name: change.name,
    version: snapshot.version,
  }
  const result = await api.transform(
    change.remove
      ? { op: 'removeProp', ...base }
      : { op: 'setProp', ...base, value: change.value! },
  )
  if (result.ok) {
    snapshots.set(target.file, result.snapshot)
    status.value = result.changed
      ? { kind: 'info', text: `Updated ${target.file}` }
      : { kind: 'info', text: 'No change needed.' }
  } else {
    status.value = {
      kind: 'error',
      text: `${result.error.code}${result.error.reason ? ` (${result.error.reason})` : ''}: ${result.error.message}`,
    }
    if (result.error.code === 'stale') await load(target.file, true)
  }
}

window.addEventListener('message', async (event: MessageEvent<PreviewToEditor>) => {
  if (event.origin !== location.origin || event.source !== frame.value?.contentWindow) return
  const message = event.data
  if (message?.type === 'vuelume:ready') {
    post({ type: 'vuelume:inspect', enabled: inspecting.value })
    post({ type: 'vuelume:highlight', target: selection.value })
  } else if (message?.type === 'vuelume:select') {
    const target: CanvasTarget = message.target
    const chain = [...target.usages].reverse()
    if (target.node) chain.push(target.node)
    await Promise.all(chain.map((r) => load(r.file, true)))
    trail.value = chain
    await select(target.usages[0] ?? target.node, true)
  }
})

watch(inspecting, (enabled) => post({ type: 'vuelume:inspect', enabled }))

onMounted(async () => {
  try {
    project.value = await api.project()
    const entry = components.value.find((c) => c.name === 'App') ?? components.value[0]
    if (entry) {
      openFile.value = entry.file
      await load(entry.file)
    }
  } catch (error) {
    status.value = { kind: 'error', text: `Could not load the project: ${String(error)}` }
  }
})

watch(openFile, (file) => file && load(file))
</script>

<template>
  <div class="layout">
    <aside class="panel left">
      <header>Components</header>
      <select v-model="openFile" class="file-picker">
        <option v-for="c in components" :key="c.file" :value="c.file">
          {{ c.name }} — {{ c.file }}
        </option>
      </select>
      <TemplateTree
        v-if="openFile && snapshots.get(openFile)?.model.template"
        :file="openFile"
        :nodes="snapshots.get(openFile)!.model.template!.children"
        :selected="selection"
        @select="select"
      />
      <p v-else class="muted">No analyzable template.</p>
    </aside>

    <main class="preview">
      <div class="toolbar">
        <label
          ><input v-model="inspecting" type="checkbox" /> Inspect (click to select, Alt+click to
          drill down)</label
        >
        <span v-if="status" :class="['status', status.kind]">{{ status.text }}</span>
      </div>
      <iframe ref="frame" src="/" title="Preview" />
    </main>

    <aside class="panel right">
      <header>Inspector</header>
      <nav v-if="trail.length > 1" class="trail">
        <button
          v-for="item in trail"
          :key="item.file + item.nodeId"
          :class="{ active: item.file === selection?.file && item.nodeId === selection?.nodeId }"
          @click="select(item, true)"
        >
          {{ nodeLabel(item) }}
        </button>
      </nav>
      <InspectorPanel
        v-if="selection && selectedElement && selectedSnapshot"
        :root="project?.root ?? ''"
        :file="selection.file"
        :element="selectedElement"
        :used-component="usedComponent"
        @edit="edit"
      />
      <p v-else class="muted">Select an element in the preview or in the tree.</p>
    </aside>
  </div>
</template>
