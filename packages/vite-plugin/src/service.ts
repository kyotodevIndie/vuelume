import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ComponentModel,
  ComponentSnapshot,
  EditError,
  HistoryState,
  Operation,
  OperationRequest,
  OperationResponse,
  ProjectModel,
} from '@vuelume/project-model'
import { findElementById } from '@vuelume/project-model'
import { analyzeProject, resolveImport } from '@vuelume/project-analyzer'
import {
  analyzeComponent,
  applyTextEdits,
  duplicateNode,
  insertNode,
  moveNode,
  removeNode,
  removeProp,
  setProp,
  setText,
  wrapNode,
  type ImportRequest,
  type TransformResult,
} from '@vuelume/vue-code-engine'
import { EditHistory, invertEdits } from './history.js'

export type { ComponentSnapshot } from '@vuelume/project-model'

type Failure = { ok: false; status: 400 | 404 | 409 | 422; error: EditError; history: HistoryState }
export type ServiceResponse = (OperationResponse & { ok: true }) | Failure

/**
 * File-system facing editing service used by the dev-server API.
 *
 * - All paths are project-relative and confined to `root` (no traversal, `.vue` only).
 * - Every operation goes through the code engine (never string manipulation here) and every
 *   write is guarded by the version (content hash) the client last saw: if the file changed in
 *   between (e.g. saved from VS Code), the operation is rejected with 409.
 * - Applied operations are recorded as text patches for undo/redo; an entry is only replayed
 *   on the exact file version it was recorded for.
 */
export class EditorService {
  #project: Promise<ProjectModel> | null = null
  readonly history = new EditHistory()

  constructor(
    readonly root: string,
    readonly aliases: Record<string, string> = {},
  ) {}

  /** Drops cached analysis; call when files change on disk. */
  invalidate(): void {
    this.#project = null
  }

  project(): Promise<ProjectModel> {
    this.#project ??= analyzeProject(this.root, { aliases: this.aliases }).catch(
      (error: unknown) => {
        this.#project = null
        throw error
      },
    )
    return this.#project
  }

  async component(file: string): Promise<ComponentSnapshot | null> {
    const absolute = this.#resolve(file)
    if (!absolute) return null
    const source = await readFile(absolute, 'utf8').catch(() => null)
    return source === null ? null : this.#snapshot(source, file)
  }

  async apply(request: OperationRequest): Promise<ServiceResponse> {
    const absolute = this.#resolve(request.file)
    if (!absolute) return this.#fail(400, 'invalid-file', 'Invalid file.')
    const source = await readFile(absolute, 'utf8').catch(() => null)
    if (source === null) return this.#fail(404, 'not-found', 'File not found.')
    if (version(source) !== request.version) {
      return this.#fail(409, 'stale', 'The file changed since it was loaded. Reload and retry.')
    }

    const label = describe(request.operation, analyzeComponent(source, { filename: request.file }))
    const prepared = await this.#prepare(request)
    if ('error' in prepared) return { ...prepared, ok: false, history: this.history.state() }
    const result = run(source, request.file, request.operation, prepared.importRequest)
    if (!result.ok)
      return { ok: false, status: 422, error: result.error, history: this.history.state() }

    if (result.changed) {
      // Re-check right before writing to keep the race window minimal.
      if ((await readFile(absolute, 'utf8')) !== source) {
        return this.#fail(409, 'stale', 'The file changed while the operation was computed.')
      }
      await writeFile(absolute, result.code, 'utf8')
      this.invalidate()
      this.history.record({
        file: request.file,
        label,
        before: version(source),
        after: version(result.code),
        edits: result.edits,
        inverse: invertEdits(source, result.edits),
        selectionBefore: request.selection ?? null,
        selectionAfter: result.nodeId ?? null,
      })
    }
    return {
      ok: true,
      file: request.file,
      changed: result.changed,
      snapshot: await this.#snapshot(result.code, request.file),
      nodeId: result.nodeId ?? null,
      history: this.history.state(),
    }
  }

  undo(): Promise<ServiceResponse> {
    return this.#replay('undo')
  }

  redo(): Promise<ServiceResponse> {
    return this.#replay('redo')
  }

  async #replay(direction: 'undo' | 'redo'): Promise<ServiceResponse> {
    const entry = direction === 'undo' ? this.history.peekUndo() : this.history.peekRedo()
    if (!entry) return this.#fail(400, 'empty', `Nothing to ${direction}.`)
    const absolute = this.#resolve(entry.file)!
    const source = await readFile(absolute, 'utf8').catch(() => null)
    const expected = direction === 'undo' ? entry.after : entry.before
    if (source === null || version(source) !== expected) {
      const dropped = this.history.dropFile(entry.file)
      return this.#fail(
        409,
        'stale-history',
        `${entry.file} changed outside the editor, so its ${dropped} history step(s) no longer apply and were cleared.`,
      )
    }
    const code = applyTextEdits(source, direction === 'undo' ? entry.inverse : entry.edits)
    if (version(code) !== (direction === 'undo' ? entry.before : entry.after)) {
      this.history.dropFile(entry.file)
      return this.#fail(
        409,
        'stale-history',
        'History could not be replayed exactly; it was cleared.',
      )
    }
    await writeFile(absolute, code, 'utf8')
    this.invalidate()
    if (direction === 'undo') this.history.commitUndo()
    else this.history.commitRedo()
    return {
      ok: true,
      file: entry.file,
      changed: true,
      snapshot: await this.#snapshot(code, entry.file),
      nodeId: direction === 'undo' ? entry.selectionBefore : entry.selectionAfter,
      history: this.history.state(),
    }
  }

  /**
   * Server-side checks that need the project: inserting a project component resolves its
   * import (reusing an existing one) and refuses to invent required props.
   */
  async #prepare(
    request: OperationRequest,
  ): Promise<{ importRequest?: ImportRequest } | Omit<Failure, 'ok' | 'history'>> {
    const operation = request.operation
    if (operation.op !== 'insertNode' || !operation.component) return {}
    const project = await this.project()
    const component = project.components.find((c) => c.file === operation.component!.file)
    if (!component)
      return { status: 404, error: { code: 'not-found', message: 'Unknown component.' } }
    if (component.file === request.file) {
      return {
        status: 422,
        error: { code: 'recursive', message: 'A component cannot be inserted into itself.' },
      }
    }
    const provided = new Set((operation.node.attributes ?? []).map((a) => a.name))
    const missing = component.props.filter(
      (p) => p.required && p.default === undefined && !provided.has(p.name),
    )
    if (missing.length > 0) {
      return {
        status: 422,
        error: {
          code: 'missing-required-props',
          message: `<${component.name}> requires ${missing.map((p) => `"${p.name}"`).join(', ')}; provide values before inserting.`,
        },
      }
    }

    // Reuse an existing import of the same file (possibly under another local name).
    const target = project.components.find((c) => c.file === request.file)
    const files = new Set(project.files.map((f) => f.file))
    for (const declaration of target?.imports ?? []) {
      if (resolveImport(request.file, declaration.source, files, this.aliases) !== component.file)
        continue
      const specifier = declaration.specifiers.find((s) => s.kind === 'default' && !s.typeOnly)
      if (specifier) {
        operation.node = { ...operation.node, tag: specifier.local }
        return { importRequest: { local: specifier.local, source: declaration.source } }
      }
    }
    let relative = path.posix.relative(path.posix.dirname(request.file), component.file)
    if (!relative.startsWith('.')) relative = `./${relative}`
    operation.node = { ...operation.node, tag: component.name }
    return { importRequest: { local: component.name, source: relative } }
  }

  /** Analyzes a file and resolves its component usages to project files (for the Inspector). */
  async #snapshot(source: string, file: string): Promise<ComponentSnapshot> {
    const model = analyzeComponent(source, { filename: file })
    const files = new Set((await this.project()).files.map((f) => f.file))
    for (const usage of model.usages) {
      if (!usage.importSource) continue
      const resolved = resolveImport(file, usage.importSource, files, this.aliases)
      if (resolved) usage.resolvedFile = resolved
    }
    return { model, version: version(source) }
  }

  #fail(status: Failure['status'], code: string, message: string): Failure {
    return { ok: false, status, error: { code, message }, history: this.history.state() }
  }

  /** Project-relative `.vue` path → absolute path inside root, or `null` if not allowed. */
  #resolve(file: string): string | null {
    if (typeof file !== 'string' || !file.endsWith('.vue') || path.isAbsolute(file)) return null
    const absolute = path.resolve(this.root, file)
    const relative = path.relative(this.root, absolute)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    return absolute
  }
}

export function version(source: string): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 16)
}

function run(
  source: string,
  filename: string,
  operation: Operation,
  importRequest: ImportRequest | undefined,
): TransformResult {
  switch (operation.op) {
    case 'setProp':
      return setProp(source, {
        filename,
        nodeId: operation.nodeId,
        name: operation.name,
        value: operation.value,
      })
    case 'removeProp':
      return removeProp(source, { filename, nodeId: operation.nodeId, name: operation.name })
    case 'setText':
      return setText(source, { filename, nodeId: operation.nodeId, text: operation.text })
    case 'insertNode':
      return insertNode(source, {
        filename,
        target: operation.target,
        node: operation.node,
        ...(importRequest ? { import: importRequest } : {}),
      })
    case 'removeNode':
      return removeNode(source, { filename, nodeId: operation.nodeId })
    case 'moveNode':
      return moveNode(source, { filename, nodeId: operation.nodeId, target: operation.target })
    case 'wrapNode':
      return wrapNode(source, { filename, nodeId: operation.nodeId, wrapper: operation.wrapper })
    case 'duplicateNode':
      return duplicateNode(source, { filename, nodeId: operation.nodeId })
    default:
      return { ok: false, error: { code: 'invalid-spec', message: 'Unknown operation.' } }
  }
}

/** Human-readable label for the history ("Set title on <ProductCard>"). */
function describe(operation: Operation, model: ComponentModel): string {
  const tagOf = (id: string | null) => {
    const el = id && model.template ? findElementById(model.template, id) : undefined
    return el ? `<${el.tag}>` : 'element'
  }
  switch (operation.op) {
    case 'setProp':
      return `Set ${operation.name} on ${tagOf(operation.nodeId)}`
    case 'removeProp':
      return `Remove ${operation.name} from ${tagOf(operation.nodeId)}`
    case 'setText':
      return `Edit text of ${tagOf(operation.nodeId)}`
    case 'insertNode':
      return `Insert <${operation.node.tag}>`
    case 'removeNode':
      return `Delete ${tagOf(operation.nodeId)}`
    case 'moveNode':
      return `Move ${tagOf(operation.nodeId)}`
    case 'wrapNode':
      return `Wrap ${tagOf(operation.nodeId)} in <${operation.wrapper.tag}>`
    case 'duplicateNode':
      return `Duplicate ${tagOf(operation.nodeId)}`
  }
}
