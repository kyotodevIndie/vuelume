import type { HistoryItem, HistoryState, NodeId } from '@vuelume/project-model'
import type { TextEdit } from '@vuelume/vue-code-engine'

/**
 * One applied change to one file, stored as text patches (not UI snapshots), so undo/redo
 * reproduce exactly what was written to disk.
 */
export interface HistoryEntry extends HistoryItem {
  /** Content hash before / after the change. */
  before: string
  after: string
  /** Edits that turn the `before` content into the `after` content. */
  edits: TextEdit[]
  /** Edits that turn the `after` content back into the `before` content. */
  inverse: TextEdit[]
  selectionBefore: NodeId | null
  selectionAfter: NodeId | null
}

/**
 * Computes the edits that undo `edits` (expressed on the content they produce).
 * `applyTextEdits(applyTextEdits(source, edits), invertEdits(source, edits)) === source`.
 */
export function invertEdits(source: string, edits: readonly TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
  let delta = 0
  return sorted.map((edit) => {
    const start = edit.start + delta
    delta += edit.text.length - (edit.end - edit.start)
    return { start, end: start + edit.text.length, text: source.slice(edit.start, edit.end) }
  })
}

/**
 * Linear undo/redo stacks across files (chronological, like a regular editor).
 * Entries are only ever applied when the file is exactly in the version the entry expects;
 * the caller checks that and drops a file's entries when it changed outside the editor.
 */
export class EditHistory {
  readonly #undo: HistoryEntry[] = []
  readonly #redo: HistoryEntry[] = []
  #nextId = 1

  constructor(readonly limit = 200) {}

  record(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
    const full = { ...entry, id: this.#nextId++ }
    this.#undo.push(full)
    if (this.#undo.length > this.limit) this.#undo.shift()
    this.#redo.length = 0
    return full
  }

  peekUndo(): HistoryEntry | undefined {
    return this.#undo.at(-1)
  }

  peekRedo(): HistoryEntry | undefined {
    return this.#redo.at(-1)
  }

  /** Moves the top undo entry to the redo stack (after it was successfully undone). */
  commitUndo(): void {
    const entry = this.#undo.pop()
    if (entry) this.#redo.push(entry)
  }

  /** Moves the top redo entry back to the undo stack (after it was successfully redone). */
  commitRedo(): void {
    const entry = this.#redo.pop()
    if (entry) this.#undo.push(entry)
  }

  /** Forgets every entry of a file (its content diverged from what the history describes). */
  dropFile(file: string): number {
    let dropped = 0
    for (const stack of [this.#undo, this.#redo]) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.file === file) {
          stack.splice(i, 1)
          dropped++
        }
      }
    }
    return dropped
  }

  state(): HistoryState {
    const item = ({ id, file, label }: HistoryEntry): HistoryItem => ({ id, file, label })
    return { undo: [...this.#undo].reverse().map(item), redo: [...this.#redo].reverse().map(item) }
  }
}
