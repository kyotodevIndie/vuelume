import type { Diagnostic, SourceRange } from './source.js'
import type { NodeId, TemplateModel } from './template.js'

/**
 * A coarse classification of a prop type, meant for choosing an Inspector widget.
 * The exact source text is always kept in {@link PropType.text}.
 */
export type PropTypeKind =
  | 'string'
  | 'number'
  | 'boolean'
  /** Union of literals: `'small' | 'medium' | 'large'` — see {@link PropType.options}. */
  | 'enum'
  | 'array'
  | 'object'
  | 'function'
  /** A named type the tool did not resolve, e.g. `Product`. */
  | 'reference'
  /** A union that is not a pure literal union, e.g. `string | number`. */
  | 'union'
  | 'unknown'

export interface PropType {
  /** Type as written by the author (whitespace-normalized), e.g. `"small" | "medium" | "large"`. */
  text: string
  kind: PropTypeKind
  /** Literal options when `kind === 'enum'`. */
  options?: (string | number | boolean)[]
}

export interface PropDefinition {
  name: string
  type: PropType
  required: boolean
  /** Default value source text, e.g. `'medium'` or `() => []`. */
  default?: string
  /** Where the prop is declared (the property signature or runtime option). */
  range: SourceRange
}

export interface EmitDefinition {
  name: string
  /** Payload signature as written, when declared with types (e.g. `id: number`). */
  payload?: string
  range: SourceRange
}

export interface SlotDefinition {
  /** `default` for unnamed `<slot>`, or `null` if the name is dynamic (`<slot :name="x">`). */
  name: string | null
  /** The `<slot>` outlet node declaring it. */
  nodeId: NodeId
}

export interface ImportSpecifierInfo {
  kind: 'default' | 'named' | 'namespace'
  /** Local binding name. */
  local: string
  /** Imported name (`default` for default imports, `*` for namespace imports). */
  imported: string
  typeOnly: boolean
}

export interface ImportInfo {
  /** Module specifier as written: `./ProductCard.vue`, `vue`, `@/types`. */
  source: string
  typeOnly: boolean
  specifiers: ImportSpecifierInfo[]
  range: SourceRange
}

/**
 * How a component used in the template was resolved.
 * - `import`: bound to an `import` in `<script setup>`
 * - `local`: bound to a non-import `<script setup>` variable (e.g. `const Comp = ...`)
 * - `builtin`: Vue built-in (`Transition`, `KeepAlive`, `Teleport`, `Suspense`, `component`, `slot`)
 * - `unresolved`: not found in `<script setup>` — global registration, auto-import, or unknown
 */
export type ComponentResolution = 'import' | 'local' | 'builtin' | 'unresolved'

export interface ComponentUsage {
  nodeId: NodeId
  /** Tag as written: `ProductCard` or `product-card`. */
  tag: string
  resolution: ComponentResolution
  /** Local binding name in `<script setup>` the tag resolved to. */
  binding?: string
  /** Import specifier the binding comes from (for `resolution === 'import'`). */
  importSource?: string
  /**
   * Project-relative file of the used component. Filled by the project analyzer
   * (the code engine alone does not touch the file system).
   */
  resolvedFile?: string
}

/**
 * - `script-setup`: `<script setup>` (the supported authoring style)
 * - `options`: `export default { ... }` / `defineComponent({ ... })` (detected, not analyzed yet)
 * - `template-only`: no script
 * - `unknown`: script present but not recognized
 */
export type ComponentApiStyle = 'script-setup' | 'options' | 'template-only' | 'unknown'

export interface ComponentModel {
  /** Project-relative file path (POSIX separators). Acts as the component id. */
  file: string
  /** Display name: `defineOptions({ name })` or derived from the file name. */
  name: string
  api: ComponentApiStyle
  /** Script language (`ts`, `js`, `tsx`, ...), if there is a script. */
  scriptLang?: string
  props: PropDefinition[]
  /** `false` when props could only be partially determined (see diagnostics). */
  propsComplete: boolean
  emits: EmitDefinition[]
  slots: SlotDefinition[]
  imports: ImportInfo[]
  template: TemplateModel | null
  usages: ComponentUsage[]
  diagnostics: Diagnostic[]
}
