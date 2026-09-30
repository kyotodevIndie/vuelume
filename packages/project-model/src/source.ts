/**
 * A position inside a source file.
 *
 * - `offset` is a 0-based UTF-16 code unit index into the file's full text
 *   (the same unit JavaScript strings use), so `source.slice(start.offset, end.offset)`
 *   always yields the exact text of a range.
 * - `line` and `column` are 1-based, matching `@vue/compiler-sfc` and most editors.
 */
export interface SourcePosition {
  offset: number
  line: number
  column: number
}

/** A half-open range `[start, end)` inside a single file. */
export interface SourceRange {
  start: SourcePosition
  end: SourcePosition
}

/** A range together with the file it belongs to (project-relative, POSIX separators). */
export interface SourceLocation {
  file: string
  range: SourceRange
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

/**
 * Something the tool noticed but could not (fully) understand.
 *
 * Diagnostics never mean the user's code is wrong — they mean the tool is being
 * conservative. `code` is a stable, machine-readable identifier (e.g. `props/imported-type`).
 */
export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  location?: SourceLocation
}
