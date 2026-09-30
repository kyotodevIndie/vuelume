import type { ComponentModel, ProjectModel } from '@vuelume/project-model'
import { API_PATH } from '@vuelume/project-model'

export interface ComponentSnapshot {
  model: ComponentModel
  version: string
}

export type PropValue = string | number | boolean

export interface ApiError {
  code: string
  message: string
  reason?: string
}

type TransformResult =
  { ok: true; changed: boolean; snapshot: ComponentSnapshot } | { ok: false; error: ApiError }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(API_PATH + path)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

export const api = {
  project: () => getJson<ProjectModel>('project'),

  component: (file: string) =>
    getJson<ComponentSnapshot>(`component?file=${encodeURIComponent(file)}`),

  async transform(
    request:
      | {
          op: 'setProp'
          file: string
          nodeId: string
          name: string
          value: PropValue
          version: string
        }
      | { op: 'removeProp'; file: string; nodeId: string; name: string; version: string },
  ): Promise<TransformResult> {
    const response = await fetch(`${API_PATH}transform`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as TransformResult
  },
}

/** Uses Vite's built-in endpoint to open a file at a position in the user's editor. */
export function openInEditor(root: string, file: string, line: number, column: number): void {
  void fetch(`/__open-in-editor?file=${encodeURIComponent(`${root}/${file}:${line}:${column}`)}`)
}
