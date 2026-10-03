import type { Statement } from '@babel/types'
import { babelParse, type SFCDescriptor } from '@vue/compiler-sfc'
import { detectEol } from '../positions.js'
import type { TextEdit } from '../transform/edits.js'

/** A default import to make available in `<script setup>`, e.g. `import ProductCard from './ProductCard.vue'`. */
export interface ImportRequest {
  local: string
  source: string
}

export type ImportPlan =
  | { ok: true; edit: TextEdit | null }
  | { ok: false; code: 'import-conflict' | 'no-script-setup' | 'parse-error'; message: string }

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/**
 * Plans the minimal edit that makes `request.local` available to the template:
 * - already imported from the same source → nothing to do;
 * - the name is taken by something else → conflict (never shadow or rename user code);
 * - `<script setup>` exists → add the import after the last import, matching quote/semicolon style;
 * - no script at all → create a `<script setup>` block containing only the import;
 * - Options API `<script>` only → refuse (registration would need `components: {}`, out of scope).
 */
export function planImport(
  source: string,
  descriptor: SFCDescriptor,
  request: ImportRequest,
): ImportPlan {
  if (!IDENTIFIER.test(request.local)) {
    return {
      ok: false,
      code: 'import-conflict',
      message: `"${request.local}" is not a valid identifier.`,
    }
  }
  const eol = detectEol(source)
  const setup = descriptor.scriptSetup

  if (!setup) {
    if (descriptor.script) {
      return {
        ok: false,
        code: 'no-script-setup',
        message:
          'This component uses a plain <script> (Options API); components cannot be imported automatically. Register it in code.',
      }
    }
    const at = source.startsWith('﻿') ? 1 : 0
    const text = `<script setup>${eol}import ${request.local} from '${request.source}'${eol}</script>${eol}${eol}`
    return { ok: true, edit: { start: at, end: at, text } }
  }

  const lang = setup.lang ?? 'js'
  let body: Statement[]
  try {
    const plugins: ('typescript' | 'jsx')[] = []
    if (lang === 'ts' || lang === 'tsx') plugins.push('typescript')
    if (lang === 'tsx' || lang === 'jsx') plugins.push('jsx')
    body = babelParse(setup.content, { sourceType: 'module', plugins }).program.body
  } catch (error) {
    return {
      ok: false,
      code: 'parse-error',
      message: `Script could not be parsed: ${(error as Error).message}`,
    }
  }

  const imports = body.filter((s) => s.type === 'ImportDeclaration')
  for (const declaration of imports) {
    for (const specifier of declaration.specifiers) {
      if (specifier.local.name !== request.local) continue
      if (
        specifier.type === 'ImportDefaultSpecifier' &&
        declaration.source.value === request.source
      ) {
        return { ok: true, edit: null }
      }
      return {
        ok: false,
        code: 'import-conflict',
        message: `"${request.local}" is already imported from "${declaration.source.value}".`,
      }
    }
  }
  if (declaresName(body, request.local)) {
    return {
      ok: false,
      code: 'import-conflict',
      message: `"${request.local}" is already declared in <script setup>.`,
    }
  }

  const base = setup.loc.start.offset
  const last = imports.at(-1)
  if (last) {
    const raw = setup.content.slice(last.start!, last.end!)
    const quote = raw.includes('"') && !raw.includes("'") ? '"' : "'"
    const semi = raw.trimEnd().endsWith(';') ? ';' : ''
    const at = base + last.end!
    return {
      ok: true,
      edit: {
        start: at,
        end: at,
        text: `${eol}import ${request.local} from ${quote}${request.source}${quote}${semi}`,
      },
    }
  }
  const line = `import ${request.local} from '${request.source}'`
  const content = setup.content
  if (content.startsWith('\r\n') || content.startsWith('\n')) {
    const at = base + (content.startsWith('\r\n') ? 2 : 1)
    return { ok: true, edit: { start: at, end: at, text: `${line}${eol}` } }
  }
  return { ok: true, edit: { start: base, end: base, text: `${eol}${line}${eol}` } }
}

function declaresName(body: Statement[], name: string): boolean {
  for (const statement of body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (!declaration) continue
    if (declaration.type === 'VariableDeclaration') {
      if (declaration.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === name))
        return true
    } else if (
      (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') &&
      declaration.id?.name === name
    ) {
      return true
    }
  }
  return false
}
