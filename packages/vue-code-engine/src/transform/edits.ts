/**
 * A minimal text replacement: replace `source.slice(start, end)` with `text`.
 *
 * Transformations are expressed as a handful of these instead of re-printing an AST:
 * everything outside the edited ranges is preserved byte-for-byte (formatting, comments,
 * code the tool does not understand). See ADR-0003.
 */
export interface TextEdit {
  start: number
  end: number
  text: string
}

/** Applies non-overlapping edits. Throws if edits overlap or are out of bounds. */
export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
  let result = ''
  let cursor = 0
  for (const edit of sorted) {
    if (edit.start < cursor || edit.end < edit.start || edit.end > source.length) {
      throw new RangeError(`Invalid or overlapping edit [${edit.start}, ${edit.end})`)
    }
    result += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return result + source.slice(cursor)
}
