import { parse, type SFCDescriptor } from '@vue/compiler-sfc'
import type { TemplateModel } from '@vuelume/project-model'
import { LineIndex } from './positions.js'
import { buildTemplateModel } from './template.js'

export interface LoadedDocument {
  source: string
  filename: string
  descriptor: SFCDescriptor
  template: TemplateModel
  lines: LineIndex
}

export interface LoadError {
  code: 'parse-error' | 'no-template'
  message: string
}

/**
 * Parses a file for editing. Files with parse errors or without an analyzable template are
 * never edited, so this is the single entry point every transformation goes through.
 */
export function loadDocument(source: string, filename: string): LoadedDocument | LoadError {
  const { descriptor, errors } = parse(source, { filename, sourceMap: false })
  if (errors.length > 0) {
    return {
      code: 'parse-error',
      message: `Refusing to edit a file with parse errors: ${errors[0]!.message}`,
    }
  }
  const lines = new LineIndex(source)
  const { template } = buildTemplateModel(descriptor.template, filename, lines)
  if (!template) return { code: 'no-template', message: 'The file has no analyzable template.' }
  return { source, filename, descriptor, template, lines }
}

export function isLoadError(value: LoadedDocument | LoadError): value is LoadError {
  return 'code' in value
}
