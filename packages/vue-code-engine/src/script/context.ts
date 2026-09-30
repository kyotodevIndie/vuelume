import type { Node, Statement } from '@babel/types'
import type { Diagnostic, SourceRange } from '@vuelume/project-model'
import type { LineIndex } from '../positions.js'

/**
 * One parsed `<script>` block.
 *
 * Babel offsets are relative to the block content; every range leaving this class is
 * converted to whole-file offsets so it can be compared with template ranges.
 * Nodes carry no reference to their block, so the block is always passed explicitly.
 */
export class ScriptBlock {
  constructor(
    readonly content: string,
    /** Whole-file offset where the block content starts. */
    readonly offset: number,
    readonly body: Statement[],
    readonly lines: LineIndex,
  ) {}

  text(node: Node): string {
    return this.content.slice(node.start!, node.end!)
  }

  range(node: Node): SourceRange {
    return this.lines.range(this.offset + node.start!, this.offset + node.end!)
  }
}

/** A node together with the block it was found in. */
export interface Located<T extends Node> {
  node: T
  block: ScriptBlock
}

export class DiagnosticSink {
  readonly diagnostics: Diagnostic[] = []

  constructor(readonly file: string) {}

  report(
    code: string,
    severity: Diagnostic['severity'],
    message: string,
    at?: Located<Node>,
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      ...(at ? { location: { file: this.file, range: at.block.range(at.node) } } : {}),
    })
  }
}

/** Collapses whitespace so multi-line types read well on one line. */
export function normalizeTypeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^\|\s*/, '')
    .trim()
}
