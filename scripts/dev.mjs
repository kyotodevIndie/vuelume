// Development loop for the tool itself: `pnpm dev`.
//
// 1. builds the packages and the editor UI once,
// 2. keeps them rebuilding on change (tsc --watch + vite build --watch),
// 3. runs the example app with the plugin, and restarts it when the plugin/engine output
//    changes (Vite loads plugins once at startup, so a restart is required for those).
//
// Editor UI changes only need a page reload. No dependencies: plain child processes.
import { spawn, spawnSync } from 'node:child_process'
import { watch } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const example = path.join(root, 'examples/basic-shop')
const playground = path.join(root, 'apps/playground')

const bin = (fromDir, pkg, name) => {
  const require = createRequire(path.join(fromDir, 'package.json'))
  const manifest = require.resolve(`${pkg}/package.json`)
  const entry = require(manifest).bin
  return path.join(path.dirname(manifest), typeof entry === 'string' ? entry : entry[name])
}
const tsc = bin(root, 'typescript', 'tsc')
const viteForUi = bin(playground, 'vite', 'vite')
const viteForExample = bin(example, 'vite', 'vite')

const run = (label, args, cwd) => {
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `[${label}] `
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) console.log(prefix + line)
    })
  }
  return child
}

console.log('[dev] initial build…')
for (const [args, cwd] of [
  [[tsc, '-b'], root],
  [[viteForUi, 'build', '--logLevel', 'warn'], playground],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const children = [
  run('tsc', [tsc, '-b', '--watch', '--preserveWatchOutput'], root),
  run('ui', [viteForUi, 'build', '--watch', '--logLevel', 'warn'], playground),
]

let app = null
const startApp = () => {
  // `pnpm dev -- --port 5179` forwards a literal `--`: drop it before handing args to Vite.
  app = run('app', [viteForExample, ...process.argv.slice(2).filter((a) => a !== '--')], example)
}
startApp()

// Restart the example when the plugin or the packages it loads are rebuilt.
let timer = null
for (const pkg of ['vite-plugin', 'vue-code-engine', 'project-analyzer', 'project-model']) {
  watch(path.join(root, 'packages', pkg, 'dist'), { recursive: true }, (_event, file) => {
    if (!file || !file.endsWith('.js')) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      console.log(`[dev] ${pkg} changed — restarting the example dev server`)
      app?.kill()
      startApp()
    }, 600)
  })
}

const killAll = () => {
  for (const child of [...children, app]) child?.kill()
}
process.on('exit', killAll)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0))
