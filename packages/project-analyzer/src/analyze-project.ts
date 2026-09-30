import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ComponentModel, Diagnostic, ProjectModel } from '@vuelume/project-model'
import { analyzeComponent, componentNameFromFile } from '@vuelume/vue-code-engine'
import { DEFAULT_IGNORED_DIRECTORIES, discoverSourceFiles } from './discover.js'
import { isProjectSpecifier, resolveImport } from './resolve.js'

export interface AnalyzeProjectOptions {
  /** Import aliases, e.g. `{ '@': 'src' }` (target relative to the project root). */
  aliases?: Record<string, string>
  /** Directory names to skip. Defaults to {@link DEFAULT_IGNORED_DIRECTORIES}. */
  ignoredDirectories?: string[]
}

/**
 * Builds a {@link ProjectModel} for the Vue project in `root`.
 *
 * Read-only: it never writes files. Each `.vue` file is analyzed independently by the code
 * engine; this layer adds what needs the file system (discovery and cross-file resolution).
 */
export async function analyzeProject(
  root: string,
  options: AnalyzeProjectOptions = {},
): Promise<ProjectModel> {
  const absoluteRoot = path.resolve(root)
  const info = await stat(absoluteRoot).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`Not a directory: ${absoluteRoot}`)

  const aliases = options.aliases ?? {}
  const files = await discoverSourceFiles(
    absoluteRoot,
    options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES,
  )
  const fileSet = new Set(files.map((f) => f.file))
  const diagnostics: Diagnostic[] = []

  const components: ComponentModel[] = []
  for (const { file } of files.filter((f) => f.kind === 'vue')) {
    components.push(await analyzeFile(absoluteRoot, file))
  }

  for (const component of components) {
    for (const usage of component.usages) {
      if (!usage.importSource) continue
      const resolved = resolveImport(component.file, usage.importSource, fileSet, aliases)
      if (resolved) usage.resolvedFile = resolved
      else if (isProjectSpecifier(usage.importSource, aliases)) {
        diagnostics.push({
          code: 'project/unresolved-import',
          severity: 'warning',
          message: `<${usage.tag}> imports "${usage.importSource}", which does not resolve to a project file.`,
          location: {
            file: component.file,
            range: component.imports.find((i) => i.source === usage.importSource)!.range,
          },
        })
      }
    }
  }

  const byName = Map.groupBy(components, (c) => c.name)
  for (const [name, group] of byName) {
    if (group.length > 1) {
      diagnostics.push({
        code: 'project/duplicate-name',
        severity: 'info',
        message: `${group.length} components are named "${name}": ${group.map((c) => c.file).join(', ')}.`,
      })
    }
  }

  return { root: absoluteRoot, components, files, diagnostics }
}

async function analyzeFile(root: string, file: string): Promise<ComponentModel> {
  try {
    const source = await readFile(path.join(root, file), 'utf8')
    return analyzeComponent(source, { filename: file })
  } catch (error) {
    // The engine is designed not to throw on user code; if it does, it is a tool bug.
    // Keep going and surface it rather than aborting the whole project.
    return {
      file,
      name: componentNameFromFile(file),
      api: 'unknown',
      props: [],
      propsComplete: false,
      emits: [],
      slots: [],
      imports: [],
      template: null,
      usages: [],
      diagnostics: [
        {
          code: 'analyzer/internal-error',
          severity: 'error',
          message: `Could not analyze file: ${(error as Error).message}`,
        },
      ],
    }
  }
}
