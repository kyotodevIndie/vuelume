import type { SourcePosition, SourceRange } from '@vuelume/project-model'

/**
 * Converts 0-based offsets into {@link SourcePosition}s (1-based line/column).
 *
 * Babel reports offsets relative to the script block content, the Vue template parser
 * relative to the whole file. Everything the engine emits is normalized to whole-file
 * offsets through one LineIndex, so ranges from both worlds are comparable.
 */
export class LineIndex {
  readonly #lineStarts: number[] = [0]

  constructor(source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) this.#lineStarts.push(i + 1)
    }
  }

  position(offset: number): SourcePosition {
    let low = 0
    let high = this.#lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.#lineStarts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return { offset, line: low + 1, column: offset - this.#lineStarts[low]! + 1 }
  }

  range(start: number, end: number): SourceRange {
    return { start: this.position(start), end: this.position(end) }
  }
}

/** Line terminator used by the file (defaults to `\n`). Inserted code must follow it. */
export function detectEol(source: string): '\n' | '\r\n' {
  const lf = source.indexOf('\n')
  return lf > 0 && source[lf - 1] === '\r' ? '\r\n' : '\n'
}
