import type {
  CanvasTarget,
  ComponentModel,
  ComponentSnapshot,
  DropPosition,
  EditorToPreview,
  HistoryState,
  InsertPosition,
  NodeRef,
  NodeSpec,
  Operation,
  OperationResponse,
  ProjectModel,
  StructuralTarget,
  TemplateChildNode,
  TemplateElementNode,
} from '@vuelume/project-model'
import { findElementById } from '@vuelume/project-model'
import { computed, reactive, shallowRef } from 'vue'
import { api } from './api'
import type { PaletteItem } from './palette'

export type Device = 'desktop' | 'tablet' | 'mobile'
export type InsertMode = 'before' | 'after' | 'inside'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

/** Something being dragged in the editor (palette item or tree node). */
export type DragPayload = { kind: 'insert'; item: PaletteItem } | { kind: 'move'; ref: NodeRef }

/** A pending insertion waiting for required props (the insert dialog). */
export interface PendingInsert {
  item: PaletteItem
  file: string
  target: StructuralTarget
}

/**
 * Editor state. The UI never edits source text: every change is an `Operation` sent to the
 * dev server, which runs it through the code engine, writes the file and records history.
 */
export const state = reactive({
  project: null as ProjectModel | null,
  snapshots: new Map<string, ComponentSnapshot>(),
  openFile: null as string | null,
  selection: null as NodeRef | null,
  /** Breadcrumb from the last canvas click (outermost first). */
  trail: [] as NodeRef[],
  history: { undo: [], redo: [] } as HistoryState,
  busy: false,
  inspecting: true,
  device: 'desktop' as Device,
  insertMode: 'after' as InsertMode,
  toasts: [] as Toast[],
  /** Operations applied in this session (the "changes" indicator). */
  changes: 0,
  lastSaved: null as Date | null,
  drag: null as DragPayload | null,
  pending: null as PendingInsert | null,
  loading: true,
  fatal: null as string | null,
})

export const frame = shallowRef<HTMLIFrameElement | null>(null)

let toastId = 0
export function toast(
  kind: Toast['kind'],
  text: string,
  ms = kind === 'error' ? 6000 : 2500,
): void {
  const id = ++toastId
  state.toasts.push({ id, kind, text })
  setTimeout(() => {
    const index = state.toasts.findIndex((t) => t.id === id)
    if (index >= 0) state.toasts.splice(index, 1)
  }, ms)
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

export const components = computed(() =>
  [...(state.project?.components ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
)
const byFile = computed(() => new Map((state.project?.components ?? []).map((c) => [c.file, c])))

export function componentByFile(file: string): ComponentModel | undefined {
  return byFile.value.get(file)
}

export function elementOf(ref: NodeRef | null): TemplateElementNode | undefined {
  if (!ref) return undefined
  const template = state.snapshots.get(ref.file)?.model.template
  return template ? findElementById(template, ref.nodeId) : undefined
}

export const selectedElement = computed(() => elementOf(state.selection))

/** For a selected component usage: the used component's definition (declared props, slots). */
export const usedComponent = computed<ComponentModel | undefined>(() => {
  const ref = state.selection
  if (!ref) return undefined
  const usage = state.snapshots.get(ref.file)?.model.usages.find((u) => u.nodeId === ref.nodeId)
  return usage?.resolvedFile ? byFile.value.get(usage.resolvedFile) : undefined
})

export function labelOf(ref: NodeRef | null): string {
  const el = elementOf(ref)
  return el ? `<${el.tag}>` : ''
}

/** Sibling elements of a node (for move up / move down). */
export function siblingsOf(ref: NodeRef): { previous?: string; next?: string } {
  const template = state.snapshots.get(ref.file)?.model.template
  if (!template) return {}
  const parentId = ref.nodeId.includes('.')
    ? ref.nodeId.slice(0, ref.nodeId.lastIndexOf('.'))
    : null
  const parent = parentId ? findElementById(template, parentId) : null
  const children: TemplateChildNode[] = parent ? parent.children : template.children
  const elements = children.filter((c): c is TemplateElementNode => c.type === 'element')
  const index = elements.findIndex((e) => e.id === ref.nodeId)
  return {
    ...(index > 0 ? { previous: elements[index - 1]!.id } : {}),
    ...(index >= 0 && index < elements.length - 1 ? { next: elements[index + 1]!.id } : {}),
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadProject(): Promise<void> {
  try {
    state.project = await api.project()
    state.history = await api.history()
    const entry = components.value.find((c) => c.name === 'App') ?? components.value[0]
    if (entry) await openFile(entry.file)
  } catch (error) {
    state.fatal = `Could not load the project: ${String(error)}`
  } finally {
    state.loading = false
  }
}

export async function loadFile(file: string): Promise<ComponentSnapshot | undefined> {
  try {
    const snapshot = await api.component(file)
    state.snapshots.set(file, snapshot)
    return snapshot
  } catch (error) {
    toast('error', `Could not load ${file}: ${String(error)}`)
  }
}

export async function openFile(file: string): Promise<void> {
  state.openFile = file
  await loadFile(file)
}

/** Re-reads files changed by HMR (from this editor or from any other tool). */
export async function refreshFiles(files: string[]): Promise<void> {
  const known = files.filter((f) => state.snapshots.has(f))
  await Promise.all(known.map((f) => loadFile(f)))
  if (state.selection && !elementOf(state.selection)) select(null)
  if (known.length > 0) {
    state.project = await api.project().catch(() => state.project)
    state.history = await api.history().catch(() => state.history)
  }
}

// ---------------------------------------------------------------------------
// Selection & preview
// ---------------------------------------------------------------------------

export function post(message: EditorToPreview): void {
  // Reactive proxies cannot be structured-cloned: send a plain copy.
  frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), location.origin)
}

export function syncPreview(): void {
  post({ type: 'vuelume:inspect', enabled: state.inspecting })
  post({ type: 'vuelume:highlight', target: state.selection, label: labelOf(state.selection) })
}

export function select(ref: NodeRef | null, trail?: NodeRef[]): void {
  state.selection = ref ? { file: ref.file, nodeId: ref.nodeId } : null
  state.trail = trail ?? (ref ? [ref] : [])
  if (ref && state.openFile !== ref.file) state.openFile = ref.file
  post({ type: 'vuelume:highlight', target: state.selection, label: labelOf(state.selection) })
}

export async function selectFromCanvas(target: CanvasTarget): Promise<void> {
  const chain = [...target.usages].reverse()
  if (target.node) chain.push(target.node)
  await Promise.all([...new Set(chain.map((r) => r.file))].map((f) => loadFile(f)))
  select(target.usages[0] ?? target.node, chain)
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function settle(response: OperationResponse, successText?: string): Promise<boolean> {
  if (response.history) state.history = response.history
  if (!response.ok) {
    const reason = response.error.reason ? ` (${response.error.reason})` : ''
    toast('error', `${response.error.message}${reason}`)
    if (response.error.code === 'stale' && state.selection) await loadFile(state.selection.file)
    return false
  }
  state.snapshots.set(response.file, response.snapshot)
  if (response.changed) {
    state.changes++
    state.lastSaved = new Date()
    if (successText) toast('success', successText)
  }
  // Structural operations shift sibling ids, so a selection is only kept when the server says
  // which node it now is; otherwise (e.g. after a removal) it is cleared rather than left
  // pointing at whatever element took the old id.
  if (response.nodeId) select({ file: response.file, nodeId: response.nodeId })
  else if (response.changed && state.selection?.file === response.file) select(null)
  else post({ type: 'vuelume:highlight', target: state.selection, label: labelOf(state.selection) })
  return true
}

/** Sends an operation for a file, with the version the UI last saw. */
export async function run(
  file: string,
  operation: Operation,
  successText?: string,
): Promise<boolean> {
  if (state.busy) return false
  const snapshot = state.snapshots.get(file) ?? (await loadFile(file))
  if (!snapshot) return false
  state.busy = true
  try {
    const selection = state.selection?.file === file ? state.selection.nodeId : null
    const response = await api.operation({ file, version: snapshot.version, operation, selection })
    return await settle(response, successText)
  } finally {
    state.busy = false
  }
}

export async function undo(): Promise<void> {
  if (state.busy || state.history.undo.length === 0) return
  const label = state.history.undo[0]!.label
  state.busy = true
  try {
    await settle(await api.undo(), `Undo: ${label}`)
  } finally {
    state.busy = false
  }
}

export async function redo(): Promise<void> {
  if (state.busy || state.history.redo.length === 0) return
  const label = state.history.redo[0]!.label
  state.busy = true
  try {
    await settle(await api.redo(), `Redo: ${label}`)
  } finally {
    state.busy = false
  }
}

const toStructural = (position: DropPosition | InsertMode): InsertPosition =>
  position === 'inside' ? 'last-child' : position

/** Where palette insertions go: relative to the selection, or at the end of the open file. */
export function insertionTarget(): { file: string; target: StructuralTarget } | null {
  if (state.selection) {
    return {
      file: state.selection.file,
      target: { nodeId: state.selection.nodeId, position: toStructural(state.insertMode) },
    }
  }
  return state.openFile
    ? { file: state.openFile, target: { nodeId: null, position: 'last-child' } }
    : null
}

/** Inserts a palette item; components with required props open the props dialog first. */
export async function insertItem(
  item: PaletteItem,
  file: string,
  target: StructuralTarget,
  props?: NodeSpec['attributes'],
): Promise<void> {
  if (item.disabled) {
    toast('error', item.disabled)
    return
  }
  if (item.required.length > 0 && !props) {
    state.pending = { item, file, target }
    return
  }
  const node: NodeSpec = props
    ? { ...item.spec, attributes: [...(item.spec.attributes ?? []), ...props] }
    : item.spec
  const operation: Operation = item.component
    ? { op: 'insertNode', target, node, component: { file: item.component.file } }
    : { op: 'insertNode', target, node }
  const inserted = await run(file, operation, `Inserted <${item.label}>`)
  if (inserted && item.warning) toast('info', item.warning, 6000)
}

export async function insertAtSelection(item: PaletteItem): Promise<void> {
  const where = insertionTarget()
  if (!where) return toast('error', 'Open a component first.')
  await insertItem(item, where.file, where.target)
}

export function dropOn(
  target: NodeRef,
  position: DropPosition | InsertMode,
  payload: DragPayload,
): Promise<void> {
  return dropAt(target.file, { nodeId: target.nodeId, position: toStructural(position) }, payload)
}

/** Applies a drop (tree or canvas): inserts a palette item or moves an element. */
export async function dropAt(
  file: string,
  target: StructuralTarget,
  payload: DragPayload,
): Promise<void> {
  if (payload.kind === 'insert') return insertItem(payload.item, file, target)
  if (payload.ref.file !== file) {
    return toast('error', 'Elements can only be moved within the same component file.')
  }
  await run(
    file,
    { op: 'moveNode', nodeId: payload.ref.nodeId, target },
    `Moved ${labelOf(payload.ref)}`,
  )
}

// Selection actions -----------------------------------------------------------

export async function removeSelection(): Promise<void> {
  const ref = state.selection
  if (ref) await run(ref.file, { op: 'removeNode', nodeId: ref.nodeId }, `Deleted ${labelOf(ref)}`)
}

export async function duplicateSelection(): Promise<void> {
  const ref = state.selection
  if (ref)
    await run(ref.file, { op: 'duplicateNode', nodeId: ref.nodeId }, `Duplicated ${labelOf(ref)}`)
}

export async function wrapSelection(tag = 'div'): Promise<void> {
  const ref = state.selection
  if (ref)
    await run(
      ref.file,
      { op: 'wrapNode', nodeId: ref.nodeId, wrapper: { tag } },
      `Wrapped in <${tag}>`,
    )
}

export async function moveSelection(direction: 'up' | 'down'): Promise<void> {
  const ref = state.selection
  if (!ref) return
  const { previous, next } = siblingsOf(ref)
  const target = direction === 'up' ? previous : next
  if (!target)
    return toast(
      'info',
      direction === 'up' ? 'Already the first element.' : 'Already the last element.',
    )
  await run(ref.file, {
    op: 'moveNode',
    nodeId: ref.nodeId,
    target: { nodeId: target, position: direction === 'up' ? 'before' : 'after' },
  })
}

/** Keyboard shortcuts shared by the editor document and the preview iframe. */
export function handleShortcut(input: {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}): boolean {
  const key = input.key.toLowerCase()
  if (input.mod && key === 'z') {
    void (input.shift ? redo() : undo())
  } else if (input.mod && key === 'y') {
    void redo()
  } else if (input.mod && key === 'd') {
    void duplicateSelection()
  } else if (input.alt && input.key === 'ArrowUp') {
    void moveSelection('up')
  } else if (input.alt && input.key === 'ArrowDown') {
    void moveSelection('down')
  } else if (key === 'delete' || key === 'backspace') {
    void removeSelection()
  } else if (key === 'escape') {
    select(null)
  } else {
    return false
  }
  return true
}
