import type { TemplateModel } from '@vuelume/project-model'
import { walkElements } from '@vuelume/project-model'

/**
 * Line/indentation helpers used to place structural edits so they follow the file's own
 * layout (one element per line with matching indentation, or inline when the author wrote it
 * inline). Offsets are UTF-16 indices into the whole file.
 */

export function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1
}

/** Offset of the line terminator (`\r\n` or `\n`) of the line containing `offset`. */
export function lineEnd(source: string, offset: number): number {
  const lf = source.indexOf('\n', offset)
  if (lf < 0) return source.length
  return lf > 0 && source[lf - 1] === '\r' ? lf - 1 : lf
}

/** Length of the line terminator starting at `offset` (0 at end of file). */
export function eolLength(source: string, offset: number): number {
  if (source[offset] === '\r' && source[offset + 1] === '\n') return 2
  return source[offset] === '\n' ? 1 : 0
}

/** `true` when only spaces/tabs precede `offset` on its line. */
export function startsLine(source: string, offset: number): boolean {
  return /^[ \t]*$/.test(source.slice(lineStart(source, offset), offset))
}

/** `true` when only spaces/tabs follow `offset` until the end of its line. */
export function endsLine(source: string, offset: number): boolean {
  return /^[ \t]*$/.test(source.slice(offset, lineEnd(source, offset)))
}

/** Leading whitespace of the line containing `offset`. */
export function lineIndent(source: string, offset: number): string {
  const start = lineStart(source, offset)
  return /^[ \t]*/.exec(source.slice(start))![0]
}

/**
 * A node occupies whole lines when it starts and ends its lines; its block then includes the
 * indentation and the trailing line terminator, so removing it leaves no blank line behind.
 */
export function blockRange(
  source: string,
  start: number,
  end: number,
): { start: number; end: number; standalone: boolean } {
  if (startsLine(source, start) && endsLine(source, end)) {
    const terminator = lineEnd(source, end)
    return {
      start: lineStart(source, start),
      end: terminator + eolLength(source, terminator),
      standalone: true,
    }
  }
  return { start, end, standalone: false }
}

/** Indentation unit used in the template (`\t` or N spaces; defaults to two spaces). */
export function detectIndentUnit(source: string, template: TemplateModel): string {
  const widths: number[] = []
  for (const element of walkElements(template)) {
    const offset = element.range.start.offset
    if (!startsLine(source, offset)) continue
    const indent = lineIndent(source, offset)
    if (indent.includes('\t')) return '\t'
    if (indent.length > 0) widths.push(indent.length)
  }
  if (widths.length === 0) return '  '
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const unit = widths.reduce(gcd)
  return ' '.repeat(Math.min(Math.max(unit, 1), 8))
}

/**
 * Re-indents a multi-line block from `from` to `to`. The first line is not touched (the caller
 * places it). Lines whose start lies inside a protected range (attribute values, `<pre>`,
 * `<textarea>`, interpolations) are left alone, since their whitespace can be significant.
 */
export function reindent(
  text: string,
  from: string,
  to: string,
  protectedRanges: readonly (readonly [number, number])[] = [],
): string {
  if (from === to) return text
  let offset = 0
  return text
    .split('\n')
    .map((line, index) => {
      const lineOffset = offset
      offset += line.length + 1
      if (index === 0) return line
      if (protectedRanges.some(([s, e]) => lineOffset > s && lineOffset < e)) return line
      if (line.trim() === '') return line
      return line.startsWith(from) ? to + line.slice(from.length) : line
    })
    .join('\n')
}
