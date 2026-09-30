import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { SourceFileInfo } from '@vuelume/project-model'

export const DEFAULT_IGNORED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  'public',
  '.git',
  '.nuxt',
  '.output',
  '.vite',
]

const KINDS: Record<string, SourceFileInfo['kind']> = {
  '.vue': 'vue',
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
}

/**
 * Lists source files under `root` (project-relative POSIX paths, sorted).
 * Skips ignored and hidden directories and does not follow symlinks.
 */
export async function discoverSourceFiles(
  root: string,
  ignoredDirectories: readonly string[] = DEFAULT_IGNORED_DIRECTORIES,
): Promise<SourceFileInfo[]> {
  const ignored = new Set(ignoredDirectories)
  const files: SourceFileInfo[] = []

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith('.')) await walk(absolute)
      } else if (entry.isFile()) {
        const name = entry.name
        if (name.endsWith('.d.ts')) continue
        const kind = KINDS[path.extname(name)]
        if (kind) files.push({ file: toPosix(path.relative(root, absolute)), kind })
      }
    }
  }

  await walk(root)
  return files.sort((a, b) => a.file.localeCompare(b.file))
}

export function toPosix(file: string): string {
  return file.split(path.sep).join('/')
}
