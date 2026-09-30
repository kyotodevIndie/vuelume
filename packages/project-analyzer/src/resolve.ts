import path from 'node:path'

const EXTENSIONS = ['.vue', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']

/**
 * Resolves an import specifier written in `importer` to a project file.
 *
 * Supports relative specifiers and explicit aliases (e.g. `{ '@': 'src' }`).
 * Bare package imports (`vue`, `primevue/button`) are not project files → `undefined`.
 * Aliases are NOT inferred from vite/tsconfig yet (see ROADMAP); pass them explicitly.
 */
export function resolveImport(
  importer: string,
  specifier: string,
  files: ReadonlySet<string>,
  aliases: Readonly<Record<string, string>> = {},
): string | undefined {
  let target: string | undefined
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = path.posix.join(path.posix.dirname(importer), specifier)
  } else {
    for (const [alias, replacement] of Object.entries(aliases)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        target = path.posix.join(replacement, specifier.slice(alias.length))
        break
      }
    }
  }
  if (target === undefined) return undefined

  const candidates = [
    target,
    ...EXTENSIONS.map((ext) => target + ext),
    ...EXTENSIONS.map((ext) => `${target}/index${ext}`),
  ]
  return candidates.find((candidate) => files.has(candidate))
}

/** `true` for specifiers that should point inside the project (relative or aliased). */
export function isProjectSpecifier(
  specifier: string,
  aliases: Readonly<Record<string, string>> = {},
): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    Object.keys(aliases).some((a) => specifier === a || specifier.startsWith(`${a}/`))
  )
}
