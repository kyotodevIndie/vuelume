import type {
  ComponentSnapshot,
  HistoryState,
  OperationRequest,
  OperationResponse,
  ProjectModel,
} from '@vuelume/project-model'
import { API_PATH } from '@vuelume/project-model'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(API_PATH + path)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

async function post(path: string, body: unknown): Promise<OperationResponse> {
  try {
    const response = await fetch(API_PATH + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()) as OperationResponse
  } catch (error) {
    return {
      ok: false,
      error: { code: 'network', message: `Dev server unreachable: ${String(error)}` },
    }
  }
}

/** Thin client for the dev-server API served by @vuelume/vite-plugin. */
export const api = {
  project: () => getJson<ProjectModel>('project'),
  component: (file: string) =>
    getJson<ComponentSnapshot>(`component?file=${encodeURIComponent(file)}`),
  history: () => getJson<HistoryState>('history'),
  operation: (request: OperationRequest) => post('operation', request),
  undo: () => post('undo', {}),
  redo: () => post('redo', {}),
}

/** Uses Vite's built-in endpoint to open a file at a position in the user's editor. */
export function openInEditor(root: string, file: string, line = 1, column = 1): void {
  void fetch(`/__open-in-editor?file=${encodeURIComponent(`${root}/${file}:${line}:${column}`)}`)
}
