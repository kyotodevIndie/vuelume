import {
  findElementAtOffset,
  findElementById,
  walkElements,
  type SourceRange,
  type TemplateElementNode,
  type TemplateModel,
} from '@vuelume/project-model'
import { describe, expect, it } from 'vitest'

const range = (start: number, end: number): SourceRange => ({
  start: { offset: start, line: 1, column: start + 1 },
  end: { offset: end, line: 1, column: end + 1 },
})

const element = (
  id: string,
  start: number,
  end: number,
  children: TemplateElementNode[] = [],
): TemplateElementNode => ({
  type: 'element',
  id,
  tag: `t${id}`,
  elementType: 'element',
  range: range(start, end),
  startTagRange: range(start, start + 3),
  selfClosing: children.length === 0,
  attributes: [],
  flags: [],
  children,
})

// <a><b/><c><d/></c></a><e/>
const template: TemplateModel = {
  lang: 'html',
  range: range(0, 100),
  children: [
    element('0', 0, 50, [
      element('0.0', 5, 10),
      element('0.1', 12, 40, [element('0.1.0', 15, 20)]),
    ]),
    { type: 'comment', content: 'x', range: range(51, 55) },
    element('1', 60, 70),
  ],
}

describe('traverse helpers', () => {
  it('walks elements depth-first in document order', () => {
    expect([...walkElements(template)].map((e) => e.id)).toEqual(['0', '0.0', '0.1', '0.1.0', '1'])
  })

  it('finds elements by id, ignoring non-element siblings', () => {
    expect(findElementById(template, '0.1.0')?.tag).toBe('t0.1.0')
    expect(findElementById(template, '1')?.tag).toBe('t1')
    expect(findElementById(template, '2')).toBeUndefined()
    expect(findElementById(template, '0.x')).toBeUndefined()
    expect(findElementById(template, '-1')).toBeUndefined()
  })

  it('finds the innermost element at an offset', () => {
    expect(findElementAtOffset(template, 16)?.id).toBe('0.1.0')
    expect(findElementAtOffset(template, 11)?.id).toBe('0')
    expect(findElementAtOffset(template, 52)).toBeUndefined()
    expect(findElementAtOffset(template, 50)).toBeUndefined() // end is exclusive
  })
})
