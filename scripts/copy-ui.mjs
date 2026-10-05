// Copies the built editor UI (apps/playground/dist) into the plugin package (dist/ui), so the
// published @vuelume/vite-plugin is self-contained and the playground app stays private.
import { cp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'apps/playground/dist')
const to = path.join(root, 'packages/vite-plugin/dist/ui')

if (!(await stat(path.join(from, 'index.html')).catch(() => null))) {
  console.error('apps/playground/dist is missing: build the UI first.')
  process.exit(1)
}
await rm(to, { recursive: true, force: true })
await cp(from, to, { recursive: true })
console.log('Copied editor UI into packages/vite-plugin/dist/ui')
