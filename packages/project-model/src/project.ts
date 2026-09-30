import type { ComponentModel } from './component.js'
import type { Diagnostic } from './source.js'

export interface SourceFileInfo {
  /** Project-relative path (POSIX separators). */
  file: string
  kind: 'vue' | 'ts' | 'js'
}

export interface ProjectModel {
  /** Absolute path of the analyzed project root. */
  root: string
  components: ComponentModel[]
  /** Every discovered source file (`.vue`, `.ts`, `.js`, ...). */
  files: SourceFileInfo[]
  diagnostics: Diagnostic[]
}
