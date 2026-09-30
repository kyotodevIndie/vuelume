/**
 * @vuelume/vite-plugin
 *
 * Dev-only integration with a Vite + Vue project:
 * - instruments templates in memory so the canvas can map DOM elements back to source nodes;
 * - exposes a local editing API backed by the code engine (version-checked writes);
 * - serves the editor UI at `/__vuelume/`, with the app itself as the live preview (HMR).
 *
 * It never runs in production builds (`apply: 'serve'`) and never adds anything to the app's
 * runtime or source files: removing the plugin leaves a normal Vue project.
 */
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ComponentUsage } from '@vuelume/project-model'
import { analyzeComponent } from '@vuelume/vue-code-engine'
import type { Plugin, ResolvedConfig } from 'vite'
import { hasSingleRootElement, instrumentSfc } from './instrument.js'
import { API_PATH, BASE_PATH } from '@vuelume/project-model'
import { EditorService, type TransformRequest } from './service.js'

export { instrumentSfc, hasSingleRootElement } from './instrument.js'
export { EditorService, version, type ComponentSnapshot, type TransformRequest } from './service.js'
export * from '@vuelume/project-model'

export interface VuelumeOptions {
  /** Extra import aliases for analysis (Vite `resolve.alias` string entries are picked up automatically). */
  aliases?: Record<string, string>
}

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_ID = 'virtual:vuelume/client'
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
}

export default function vuelume(options: VuelumeOptions = {}): Plugin {
  let config: ResolvedConfig
  let service: EditorService
  const rootCache = new Map<string, { mtimeMs: number; single: boolean }>()

  /** Whether a used component renders a single root, so a marker attribute can fall through. */
  async function singleRoot(resolvedId: string): Promise<boolean> {
    const file = resolvedId.split('?')[0]!
    if (!file.endsWith('.vue')) return true // compiled library component: assume single root
    const info = await stat(file).catch(() => null)
    if (!info) return true
    const cached = rootCache.get(file)
    if (cached?.mtimeMs === info.mtimeMs) return cached.single
    const source = await readFile(file, 'utf8')
    const single = hasSingleRootElement(analyzeComponent(source, { filename: file }))
    rootCache.set(file, { mtimeMs: info.mtimeMs, single })
    return single
  }

  return {
    name: 'vuelume',
    apply: 'serve',
    enforce: 'pre',

    configResolved(resolved) {
      config = resolved
      service = new EditorService(config.root, { ...aliasesFrom(config), ...options.aliases })
    },

    configureServer(server) {
      const onChange = (file: string) => {
        if (file.endsWith('.vue')) {
          service.invalidate()
          rootCache.delete(file)
        }
      }
      server.watcher.on('change', onChange).on('add', onChange).on('unlink', onChange)
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(BASE_PATH)) return next()
        handle(req, res, service).catch((error: unknown) => {
          config.logger.error(`[vuelume] ${(error as Error).stack ?? String(error)}`)
          if (!res.headersSent) json(res, 500, { code: 'internal', message: String(error) })
        })
      })
      server.httpServer?.once('listening', () => {
        const address = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/'
        config.logger.info(`  ➜  vuelume editor: ${new URL(BASE_PATH, address).href}`)
      })
    },

    // The browser runtime goes through Vite's pipeline so its imports resolve normally.
    resolveId(id) {
      return id === CLIENT_ID ? path.join(RUNTIME_DIR, 'client.js') : null
    },

    transformIndexHtml() {
      return [
        { tag: 'script', attrs: { type: 'module', src: `/@id/${CLIENT_ID}` }, injectTo: 'head' },
      ]
    },

    async transform(code, id) {
      const [file, query] = id.split('?')
      if (!file?.endsWith('.vue') || query || file.includes('/node_modules/')) return null
      const relative = path.relative(config.root, file)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null
      const posix = relative.split(path.sep).join('/')

      const model = analyzeComponent(code, { filename: posix })
      const decisions = new Map<string, boolean>()
      for (const usage of model.usages) {
        if (usage.resolution !== 'import' || !usage.importSource) continue
        const resolved = await this.resolve(usage.importSource, file)
        decisions.set(usage.nodeId, resolved ? await singleRoot(resolved.id) : true)
      }
      const result = instrumentSfc(code, {
        file: posix,
        markUsage: (usage: ComponentUsage) => decisions.get(usage.nodeId) ?? true,
      })
      return result ? { code: result.code, map: result.map } : null
    },
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  service: EditorService,
): Promise<void> {
  const url = new URL(req.url!, 'http://localhost')

  if (url.pathname.startsWith(API_PATH)) {
    const route = url.pathname.slice(API_PATH.length)
    if (req.method === 'GET' && route === 'project') {
      return json(res, 200, await service.project())
    }
    if (req.method === 'GET' && route === 'component') {
      const snapshot = await service.component(url.searchParams.get('file') ?? '')
      return snapshot
        ? json(res, 200, snapshot)
        : json(res, 404, { code: 'not-found', message: 'Not found.' })
    }
    if (req.method === 'POST' && route === 'transform') {
      // Writes are only accepted from the editor page itself: JSON content type (forces a CORS
      // preflight for cross-site requests, which we never answer) and a same-origin check.
      if (!req.headers['content-type']?.startsWith('application/json') || !sameOrigin(req)) {
        return json(res, 403, {
          code: 'forbidden',
          message: 'Cross-origin writes are not allowed.',
        })
      }
      const request = JSON.parse(await body(req)) as TransformRequest
      const result = await service.transform(request)
      return result.ok ? json(res, 200, result) : json(res, result.status, result)
    }
    return json(res, 404, { code: 'not-found', message: 'Unknown API route.' })
  }

  // Editor UI (pre-built single-page app).
  const uiDir = path.join(
    path.dirname(createRequire(import.meta.url).resolve('@vuelume/playground/package.json')),
    'dist',
  )
  const relative = url.pathname.slice(BASE_PATH.length) || 'index.html'
  const target = path.resolve(uiDir, relative)
  if (!target.startsWith(uiDir)) return json(res, 403, { code: 'forbidden', message: 'Forbidden.' })
  const exists = await stat(target)
    .then((s) => s.isFile())
    .catch(() => false)
  return serveFile(res, exists ? target : path.join(uiDir, 'index.html'))
}

async function serveFile(res: ServerResponse, file: string): Promise<void> {
  const content = await readFile(file).catch(() => null)
  if (!content) {
    res.statusCode = 404
    res.end('Not found. Did you run `pnpm build`?')
    return
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.end(content)
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > 1_000_000) reject(new Error('Request body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin') return false
  const origin = req.headers.origin
  return !origin || new URL(origin).host === req.headers.host
}

/** Vite `resolve.alias` string entries → analyzer aliases (project-relative targets). */
function aliasesFrom(config: ResolvedConfig): Record<string, string> {
  const aliases: Record<string, string> = {}
  const entries = Array.isArray(config.resolve.alias) ? config.resolve.alias : []
  for (const { find, replacement } of entries) {
    if (typeof find !== 'string' || typeof replacement !== 'string') continue
    const relative = path.relative(config.root, replacement)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      aliases[find] = relative.split(path.sep).join('/') || '.'
    }
  }
  return aliases
}
