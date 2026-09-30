import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ComponentModel, ProjectModel } from '@vuelume/project-model'
import { analyzeProject, resolveImport } from '@vuelume/project-analyzer'
import {
  analyzeComponent,
  removeProp,
  setProp,
  type PropValue,
  type TransformError,
} from '@vuelume/vue-code-engine'

export interface ComponentSnapshot {
  model: ComponentModel
  /** Content hash of the source the model was computed from (optimistic concurrency token). */
  version: string
}

export type TransformRequest =
  | { op: 'setProp'; file: string; nodeId: string; name: string; value: PropValue; version: string }
  | { op: 'removeProp'; file: string; nodeId: string; name: string; version: string }

export type TransformResponse =
  | { ok: true; changed: boolean; snapshot: ComponentSnapshot }
  | {
      ok: false
      status: 400 | 404 | 409 | 422
      error: TransformError | { code: string; message: string }
    }

/**
 * File-system facing editing service used by the dev-server API.
 *
 * - All paths are project-relative and confined to `root` (no traversal, `.vue` only).
 * - Every write is guarded by the version (content hash) the client last saw: if the file changed
 *   in between (e.g. saved from VS Code), the edit is rejected with 409 instead of being applied
 *   to content the user did not see.
 */
export class EditorService {
  #project: Promise<ProjectModel> | null = null

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

  async transform(request: TransformRequest): Promise<TransformResponse> {
    const absolute = this.#resolve(request.file)
    if (!absolute) {
      return { ok: false, status: 400, error: { code: 'invalid-file', message: 'Invalid file.' } }
    }
    const source = await readFile(absolute, 'utf8').catch(() => null)
    if (source === null) {
      return { ok: false, status: 404, error: { code: 'not-found', message: 'File not found.' } }
    }
    if (version(source) !== request.version) {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'stale',
          message: 'The file changed since it was loaded. Reload and retry.',
        },
      }
    }

    const target = { filename: request.file, nodeId: request.nodeId, name: request.name }
    const result =
      request.op === 'setProp'
        ? setProp(source, { ...target, value: request.value })
        : removeProp(source, target)
    if (!result.ok) return { ok: false, status: 422, error: result.error }

    if (result.changed) {
      // Re-check right before writing to keep the race window minimal.
      if ((await readFile(absolute, 'utf8')) !== source) {
        return {
          ok: false,
          status: 409,
          error: { code: 'stale', message: 'The file changed while the edit was computed.' },
        }
      }
      await writeFile(absolute, result.code, 'utf8')
      this.invalidate()
    }
    return {
      ok: true,
      changed: result.changed,
      snapshot: await this.#snapshot(result.code, request.file),
    }
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
