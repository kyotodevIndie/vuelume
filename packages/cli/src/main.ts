import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { analyzeProject, discoverSourceFiles } from '@vuelume/project-analyzer'
import {
  analyzeComponent,
  checkRoundTrip,
  removeProp,
  setProp,
  type PropValue,
  type TransformResult,
} from '@vuelume/vue-code-engine'
import { formatChange, formatDiagnostic, formatProject, formatTemplateTree } from './format.js'

export const CLI_NAME = 'vuelume'

const HELP = `${CLI_NAME} — code-first visual tooling for Vue (experimental)

Usage:
  ${CLI_NAME} inspect <project-dir> [--json] [--alias @=src ...]
      Discover components, props, emits, slots and component usage.

  ${CLI_NAME} tree <file.vue> [--json]
      Show the template model: node ids, source locations, editability.

  ${CLI_NAME} set-prop <file.vue> <node-id> <name> <value> [--type string|number|boolean] [--write]
  ${CLI_NAME} remove-prop <file.vue> <node-id> <name> [--write]
      Apply a safe transformation. Prints the change; only writes with --write.

  ${CLI_NAME} verify <project-dir>
      Read-only self-check: tries every supported edit on every element in memory and
      checks the source round-trips byte-for-byte. Never writes files.

Options:
  -h, --help   Show this help.
`

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
}

const defaultIo: Io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
}

class UsageError extends Error {}

/** Runs the CLI. Returns the process exit code (0 ok, 1 failure, 2 usage error). */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'inspect':
        return await inspect(rest, io)
      case 'tree':
        return await tree(rest, io)
      case 'verify':
        return await verify(rest, io)
      case 'set-prop':
      case 'remove-prop':
        return await transform(command, rest, io)
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        io.out(HELP)
        return 0
      default:
        throw new UsageError(`Unknown command "${command}".`)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n\n${HELP}`)
      return 2
    }
    io.err(`Error: ${(error as Error).message}`)
    return 1
  }
}

async function inspect(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    json: { type: 'boolean' },
    alias: { type: 'string', multiple: true },
  })
  const dir = positionals[0]
  if (!dir) throw new UsageError('inspect: missing <project-dir>.')

  const aliases: Record<string, string> = {}
  for (const entry of values.alias ?? []) {
    const [key, target] = entry.split('=')
    if (!key || !target) throw new UsageError(`Invalid --alias "${entry}", expected key=path.`)
    aliases[key] = target
  }

  const project = await analyzeProject(dir, { aliases })
  io.out(values.json ? JSON.stringify(project, null, 2) : formatProject(project, dir))
  return 0
}

async function verify(args: string[], io: Io): Promise<number> {
  const { positionals } = parse(args, {})
  const dir = positionals[0]
  if (!dir) throw new UsageError('verify: missing <project-dir>.')
  const root = path.resolve(dir)
  const files = (await discoverSourceFiles(root)).filter((f) => f.kind === 'vue')

  let checked = 0
  let elements = 0
  let passed = 0
  let refused = 0
  let failures = 0
  for (const { file } of files) {
    const report = checkRoundTrip(await readFile(path.join(root, file), 'utf8'), file)
    if (!report.checked) {
      io.out(`- ${file}: skipped (no template or parse errors)`)
      continue
    }
    checked++
    elements += report.elements
    passed += report.passed
    refused += report.refused
    failures += report.failures.length
    for (const failure of report.failures) {
      io.out(`✖ ${file} node ${failure.nodeId}: ${failure.operation} — ${failure.detail}`)
    }
  }
  io.out(
    `
Checked ${checked}/${files.length} files, ${elements} elements: ` +
      `${passed} round-trips passed, ${refused} refused (outside safe subset), ${failures} failed.`,
  )
  return failures > 0 ? 1 : 0
}

async function tree(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, { json: { type: 'boolean' } })
  const file = positionals[0]
  if (!file) throw new UsageError('tree: missing <file.vue>.')
  const source = await readFile(file, 'utf8')
  const model = analyzeComponent(source, { filename: toPosix(file) })
  if (values.json) {
    io.out(JSON.stringify(model.template, null, 2))
    return 0
  }
  if (!model.template) {
    io.out(`${file}: no analyzable template`)
  } else {
    io.out(formatTemplateTree(model.file, model.template, source))
  }
  for (const diagnostic of model.diagnostics) io.out(formatDiagnostic(diagnostic, ''))
  return 0
}

async function transform(
  command: 'set-prop' | 'remove-prop',
  args: string[],
  io: Io,
): Promise<number> {
  const { values, positionals } = parse(args, {
    write: { type: 'boolean' },
    type: { type: 'string' },
  })
  const [file, nodeId, name, rawValue] = positionals
  if (!file || !nodeId || !name) throw new UsageError(`${command}: missing arguments.`)

  const source = await readFile(file, 'utf8')
  const filename = toPosix(file)
  let result: TransformResult
  if (command === 'set-prop') {
    if (rawValue === undefined) throw new UsageError('set-prop: missing <value>.')
    result = setProp(source, { filename, nodeId, name, value: parseValue(rawValue, values.type) })
  } else {
    result = removeProp(source, { filename, nodeId, name })
  }

  if (!result.ok) {
    const reason = result.error.reason ? ` (${result.error.reason})` : ''
    io.err(`✖ ${result.error.code}${reason}: ${result.error.message}`)
    return 1
  }
  if (!result.changed) {
    io.out('No change needed.')
    return 0
  }
  io.out(`${file}\n${formatChange(source, result.code)}`)
  if (values.write) {
    // Guard against the file changing between read and write (e.g. the user saving in an editor).
    if ((await readFile(file, 'utf8')) !== source) {
      io.err('✖ File changed on disk while the transformation was computed; nothing written.')
      return 1
    }
    await writeFile(file, result.code, 'utf8')
    io.out('✔ Written.')
  } else {
    io.out('(dry run — pass --write to apply)')
  }
  return 0
}

function parseValue(raw: string, type: unknown): PropValue {
  switch (type ?? 'string') {
    case 'string':
      return raw
    case 'number': {
      const value = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(value))
        throw new UsageError(`"${raw}" is not a number.`)
      return value
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') throw new UsageError(`"${raw}" is not true/false.`)
      return raw === 'true'
    default:
      throw new UsageError(`Unknown --type "${String(type)}".`)
  }
}

type OptionSpec = Record<string, { type: 'boolean' | 'string'; multiple?: boolean }>

function parse<T extends OptionSpec>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
}

function toPosix(file: string): string {
  return path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')
}
