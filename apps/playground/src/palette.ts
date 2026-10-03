import type { ComponentModel, EditValue, NodeSpec, PropDefinition } from '@vuelume/project-model'

export interface PaletteItem {
  id: string
  kind: 'html' | 'component'
  label: string
  /** Secondary text (file for components, description for HTML). */
  detail: string
  spec: NodeSpec
  /** For project components. */
  component?: ComponentModel
  /** Why the item cannot be inserted automatically (shown, item disabled). */
  disabled?: string
  /** Required props without default the user must fill before inserting. */
  required: PropDefinition[]
  /** Insertion is allowed but may need manual follow-up (e.g. props not fully analyzed). */
  warning?: string
}

const html = (tag: string, detail: string, extra: Partial<NodeSpec> = {}): PaletteItem => ({
  id: `html:${tag}`,
  kind: 'html',
  label: tag,
  detail,
  spec: { tag, ...extra },
  required: [],
})

export const HTML_ITEMS: PaletteItem[] = [
  html('div', 'Generic container'),
  html('section', 'Page section'),
  html('header', 'Header region'),
  html('footer', 'Footer region'),
  html('nav', 'Navigation'),
  html('main', 'Main content'),
  html('article', 'Self-contained content'),
  html('h1', 'Heading 1', { text: 'Heading' }),
  html('h2', 'Heading 2', { text: 'Heading' }),
  html('h3', 'Heading 3', { text: 'Heading' }),
  html('p', 'Paragraph', { text: 'Text' }),
  html('span', 'Inline text', { text: 'Text' }),
  html('a', 'Link', { text: 'Link', attributes: [{ name: 'href', value: '#' }] }),
  html('button', 'Button', { text: 'Button', attributes: [{ name: 'type', value: 'button' }] }),
  html('img', 'Image', {
    attributes: [
      { name: 'src', value: '' },
      { name: 'alt', value: '' },
    ],
  }),
  html('ul', 'List'),
  html('li', 'List item', { text: 'Item' }),
  html('input', 'Input', { attributes: [{ name: 'type', value: 'text' }] }),
  html('label', 'Label', { text: 'Label' }),
]

const LITERAL_KINDS = new Set(['string', 'number', 'boolean', 'enum'])

/** Palette entries for the project's own components, with insertion constraints. */
export function componentItems(
  components: ComponentModel[],
  currentFile: string | null,
): PaletteItem[] {
  return components
    .filter((c) => c.template !== null || c.api !== 'unknown')
    .map((component) => {
      const required = component.props.filter((p) => p.required && p.default === undefined)
      let disabled: string | undefined
      if (!/^[A-Za-z_$][\w$]*$/.test(component.name)) {
        disabled = `"${component.name}" is not a valid identifier for an import.`
      } else if (component.file === currentFile) {
        disabled = 'A component cannot be inserted into itself.'
      } else {
        const complex = required.find((p) => !LITERAL_KINDS.has(p.type.kind))
        if (complex) {
          disabled = `Requires "${complex.name}" (${complex.type.text}), which cannot be entered visually. Insert it in code.`
        }
      }
      const warning = component.propsComplete
        ? undefined
        : `Props of ${component.name} could not be fully analyzed (imported types or Options API): check required props in code after inserting.`
      return {
        ...(warning ? { warning } : {}),
        id: `component:${component.file}`,
        kind: 'component' as const,
        label: component.name,
        detail: component.file,
        spec: { tag: component.name },
        component,
        required,
        ...(disabled ? { disabled } : {}),
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Default value suggested for a required prop in the insert dialog. */
export function initialValue(prop: PropDefinition): EditValue {
  switch (prop.type.kind) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'enum':
      return prop.type.options?.[0] ?? ''
    default:
      return ''
  }
}
