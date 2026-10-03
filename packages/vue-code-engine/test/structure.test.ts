import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkElements } from '@vuelume/project-model'
import {
  analyzeComponent,
  duplicateNode,
  insertNode,
  moveNode,
  removeNode,
  setText,
  wrapNode,
  type TransformResult,
} from '@vuelume/vue-code-engine'
import { describe, expect, it } from 'vitest'

const page = (template: string, script = `import Card from './Card.vue'`) =>
  `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n\n<style scoped>\n.a { color: red }\n</style>\n`

function ok(result: TransformResult): { code: string; nodeId: string | undefined } {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return { code: result.code, nodeId: result.nodeId }
}

function errorOf(result: TransformResult): string {
  if (result.ok) throw new Error('expected a failure')
  return result.error.code
}

const BASE = page(`  <main class="page">
    <!-- header -->
    <h1>Title</h1>
    <Card
      title="A"
      :price="item.price * 2"
      @select="pick(item)"
    />
    <p v-if="ok">yes</p>
    <p v-else-if="maybe">maybe</p>
    <p v-else>no</p>
    <ul>
      <li v-for="i in items" :key="i.id">{{ i.name }}</li>
    </ul>
    <img src="/a.png">
  </main>`)

describe('insertNode', () => {
  it('inserts before/after an element on its own line, with the same indentation', () => {
    const after = ok(
      insertNode(BASE, {
        target: { nodeId: '0.0', position: 'after' },
        node: { tag: 'p', text: 'Hi' },
      }),
    )
    expect(after.code).toBe(
      BASE.replace('    <h1>Title</h1>\n', '    <h1>Title</h1>\n    <p>Hi</p>\n'),
    )
    expect(after.nodeId).toBe('0.1')

    const before = ok(
      insertNode(BASE, { target: { nodeId: '0.0', position: 'before' }, node: { tag: 'hr' } }),
    )
    expect(before.code).toBe(
      BASE.replace('    <h1>Title</h1>\n', '    <hr />\n    <h1>Title</h1>\n'),
    )
  })

  it('inserts as first/last child, following the existing children indentation', () => {
    const last = ok(
      insertNode(BASE, {
        target: { nodeId: '0.5', position: 'last-child' },
        node: { tag: 'li', text: 'new' },
      }),
    )
    expect(last.code).toContain('{{ i.name }}</li>\n      <li>new</li>\n    </ul>')
    expect(last.nodeId).toBe('0.5.1')

    const first = ok(
      insertNode(BASE, { target: { nodeId: '0', position: 'first-child' }, node: { tag: 'nav' } }),
    )
    expect(first.code).toContain('<main class="page">\n    <nav></nav>\n    <!-- header -->')
    expect(first.nodeId).toBe('0.0')
  })

  it('opens a self-closing component to give it slot content', () => {
    const result = ok(
      insertNode(BASE, {
        target: { nodeId: '0.1', position: 'last-child' },
        node: { tag: 'span', text: 'slot' },
      }),
    )
    expect(result.code).toContain(
      `@select="pick(item)"\n    >\n      <span>slot</span>\n    </Card>`,
    )
  })

  it('inserts at the template root', () => {
    const result = ok(
      insertNode(BASE, {
        target: { nodeId: null, position: 'last-child' },
        node: { tag: 'footer' },
      }),
    )
    expect(result.code).toContain('  </main>\n  <footer></footer>\n</template>')
    expect(result.nodeId).toBe('1')
  })

  it('expands an empty inline element when it sits on its own line', () => {
    const input = page('  <div class="box"></div>')
    const result = ok(
      insertNode(input, { target: { nodeId: '0', position: 'last-child' }, node: { tag: 'span' } }),
    )
    expect(result.code).toContain('  <div class="box">\n    <span></span>\n  </div>')
  })

  it('escapes text and renders literal attributes', () => {
    const result = ok(
      insertNode(BASE, {
        target: { nodeId: '0.0', position: 'after' },
        node: {
          tag: 'a',
          text: 'Tom & <Jerry> {{ x }}',
          attributes: [
            { name: 'href', value: '/a?b="c"' },
            { name: 'tabindex', value: 0 },
          ],
        },
      }),
    )
    expect(result.code).toContain(
      '<a href="/a?b=&quot;c&quot;" :tabindex="0">Tom & &lt;Jerry> &#123;&#123; x }}</a>',
    )
  })

  it('adds the import for a new component, matching the script style', () => {
    const result = ok(
      insertNode(BASE, {
        target: { nodeId: '0.0', position: 'after' },
        node: { tag: 'Badge', attributes: [{ name: 'label', value: 'New' }] },
        import: { local: 'Badge', source: './Badge.vue' },
      }),
    )
    expect(result.code).toContain(
      `import Card from './Card.vue'\nimport Badge from './Badge.vue'\n</script>`,
    )
    expect(result.code).toContain('    <h1>Title</h1>\n    <Badge label="New" />\n')
  })

  it('reuses an existing import and refuses name conflicts', () => {
    const reuse = ok(
      insertNode(BASE, {
        target: { nodeId: '0.0', position: 'after' },
        node: { tag: 'Card' },
        import: { local: 'Card', source: './Card.vue' },
      }),
    )
    expect(reuse.code.match(/import Card/g)).toHaveLength(1)

    const clash = insertNode(BASE, {
      target: { nodeId: '0.0', position: 'after' },
      node: { tag: 'Card' },
      import: { local: 'Card', source: './other/Card.vue' },
    })
    expect(errorOf(clash)).toBe('import-conflict')

    const local = page('  <div />', `const Badge = 1`)
    expect(
      errorOf(
        insertNode(local, {
          target: { nodeId: '0', position: 'after' },
          node: { tag: 'Badge' },
          import: { local: 'Badge', source: './Badge.vue' },
        }),
      ),
    ).toBe('import-conflict')
  })

  it('creates <script setup> in a template-only file and refuses Options API files', () => {
    const templateOnly = '<template>\n  <div />\n</template>\n'
    const created = ok(
      insertNode(templateOnly, {
        target: { nodeId: '0', position: 'after' },
        node: { tag: 'Badge' },
        import: { local: 'Badge', source: './Badge.vue' },
      }),
    )
    expect(created.code).toBe(
      `<script setup>\nimport Badge from './Badge.vue'\n</script>\n\n<template>\n  <div />\n  <Badge />\n</template>\n`,
    )

    const options = `<script>\nexport default {}\n</script>\n<template>\n  <div />\n</template>\n`
    expect(
      errorOf(
        insertNode(options, {
          target: { nodeId: '0', position: 'after' },
          node: { tag: 'Badge' },
          import: { local: 'Badge', source: './Badge.vue' },
        }),
      ),
    ).toBe('no-script-setup')
  })

  it('refuses structurally invalid positions', () => {
    const cases: [string, Parameters<typeof insertNode>[1]['target'], string][] = [
      ['inside a void element', { nodeId: '0.6', position: 'first-child' }, 'invalid-target'],
      ['between v-if and v-else-if', { nodeId: '0.2', position: 'after' }, 'conditional-chain'],
      ['before v-else', { nodeId: '0.4', position: 'before' }, 'conditional-chain'],
      ['sibling of the template root', { nodeId: null, position: 'before' }, 'invalid-target'],
      ['unknown node', { nodeId: '9', position: 'after' }, 'node-not-found'],
    ]
    for (const [, target, code] of cases) {
      expect(errorOf(insertNode(BASE, { target, node: { tag: 'span' } }))).toBe(code)
    }
    expect(
      errorOf(
        insertNode(page('  <div v-html="raw" />'), {
          target: { nodeId: '0', position: 'last-child' },
          node: { tag: 'b' },
        }),
      ),
    ).toBe('invalid-target')
    expect(
      errorOf(
        insertNode(page('  <textarea>x</textarea>'), {
          target: { nodeId: '0', position: 'last-child' },
          node: { tag: 'b' },
        }),
      ),
    ).toBe('invalid-target')
    expect(
      errorOf(
        insertNode(BASE, {
          target: { nodeId: '0', position: 'after' },
          node: { tag: 'div', attributes: [{ name: '@click', value: 'x' }] },
        }),
      ),
    ).toBe('invalid-spec')
    expect(
      errorOf(
        insertNode(BASE, { target: { nodeId: '0', position: 'after' }, node: { tag: 'script' } }),
      ),
    ).toBe('invalid-spec')
  })

  it('handles slot templates', () => {
    const input = page(`  <Card>
    <template #header>
      <h2>Head</h2>
    </template>
  </Card>`)
    const footer = ok(
      insertNode(input, {
        target: { nodeId: '0', position: 'last-child' },
        node: { tag: 'template', slot: 'footer', text: 'Foot' },
      }),
    )
    expect(footer.code).toContain(
      '    </template>\n    <template #footer>Foot</template>\n  </Card>',
    )
    expect(
      errorOf(
        insertNode(input, {
          target: { nodeId: '0', position: 'last-child' },
          node: { tag: 'template', slot: 'header' },
        }),
      ),
    ).toBe('invalid-target')
    expect(
      errorOf(
        insertNode(input, {
          target: { nodeId: '0.0', position: 'first-child' },
          node: { tag: 'template', slot: 'x' },
        }),
      ),
    ).toBe('invalid-target')

    const explicitDefault = page(`  <Card>
    <template #default>
      <p>a</p>
    </template>
  </Card>`)
    expect(
      errorOf(
        insertNode(explicitDefault, {
          target: { nodeId: '0', position: 'last-child' },
          node: { tag: 'p' },
        }),
      ),
    ).toBe('invalid-target')
    ok(
      insertNode(explicitDefault, {
        target: { nodeId: '0.0', position: 'last-child' },
        node: { tag: 'p' },
      }),
    )
  })
})

describe('removeNode', () => {
  it('removes whole lines, keeping everything else byte-for-byte', () => {
    const result = ok(removeNode(BASE, { nodeId: '0.1' }))
    expect(result.code).toBe(
      BASE.replace(
        `    <Card
      title="A"
      :price="item.price * 2"
      @select="pick(item)"
    />\n`,
        '',
      ),
    )
  })

  it('removes inline elements without touching surrounding text', () => {
    const input = page('  <p>Hello <b>big</b> world</p>')
    expect(ok(removeNode(input, { nodeId: '0.0' })).code).toBe(page('  <p>Hello  world</p>'))
  })

  it('protects v-if/v-else chains but allows removing later branches', () => {
    expect(errorOf(removeNode(BASE, { nodeId: '0.2' }))).toBe('conditional-chain')
    expect(ok(removeNode(BASE, { nodeId: '0.3' })).code).not.toContain('v-else-if')
    expect(ok(removeNode(BASE, { nodeId: '0.4' })).code).not.toContain('<p v-else>')
  })
})

describe('moveNode', () => {
  it('moves atomically and re-indents the moved block', () => {
    const result = ok(
      moveNode(BASE, { nodeId: '0.1', target: { nodeId: '0.5', position: 'last-child' } }),
    )
    expect(result.code).toContain(`{{ i.name }}</li>
      <Card
        title="A"
        :price="item.price * 2"
        @select="pick(item)"
      />
    </ul>`)
    expect(result.code.match(/<Card/g)).toHaveLength(1)
    expect(result.nodeId).toBe('0.4.1')
  })

  it('reorders siblings and keeps dynamic attributes and events intact', () => {
    const result = ok(
      moveNode(BASE, { nodeId: '0.1', target: { nodeId: '0.0', position: 'before' } }),
    )
    expect(result.code).toContain(`<!-- header -->
    <Card
      title="A"
      :price="item.price * 2"
      @select="pick(item)"
    />
    <h1>Title</h1>`)
  })

  it('moves an element out of a container to the root', () => {
    const result = ok(
      moveNode(BASE, { nodeId: '0.5', target: { nodeId: null, position: 'last-child' } }),
    )
    expect(result.code).toContain(`  </main>
  <ul>
    <li v-for="i in items" :key="i.id">{{ i.name }}</li>
  </ul>
</template>`)
  })

  it('does not re-indent whitespace-sensitive content', () => {
    const input = page(`  <div>
    <section>
      <pre>line 1
  line 2</pre>
    </section>
  </div>
  <aside></aside>`)
    const result = ok(
      moveNode(input, { nodeId: '0.0', target: { nodeId: '1', position: 'last-child' } }),
    )
    expect(result.code).toContain('<pre>line 1\n  line 2</pre>')
  })

  it('re-indents multi-line comments inside wrapped content', () => {
    const input = page(`  <div>
    <!-- a comment
         over two lines -->
    <span>x</span>
  </div>`)
    const result = ok(wrapNode(input, { nodeId: '0', wrapper: { tag: 'section' } }))
    expect(result.code).toContain(
      '      <!-- a comment' + String.fromCharCode(10) + '           over two lines -->',
    )
  })

  it('never adds whitespace inside <pre>', () => {
    const input = page(
      '  <pre><code>' +
        String.fromCharCode(10) +
        'line' +
        String.fromCharCode(10, 10) +
        '</code></pre>',
    )
    const result = ok(
      insertNode(input, { target: { nodeId: '0.0', position: 'last-child' }, node: { tag: 'b' } }),
    )
    expect(result.code).toContain('line' + String.fromCharCode(10, 10) + '<b></b></code></pre>')
  })

  it('refuses invalid moves', () => {
    expect(
      errorOf(moveNode(BASE, { nodeId: '0', target: { nodeId: '0.5', position: 'after' } })),
    ).toBe('invalid-target')
    expect(
      errorOf(moveNode(BASE, { nodeId: '0.3', target: { nodeId: '0.0', position: 'after' } })),
    ).toBe('conditional-chain')
    expect(
      errorOf(moveNode(BASE, { nodeId: '0.2', target: { nodeId: '0.0', position: 'after' } })),
    ).toBe('conditional-chain')
    expect(
      errorOf(
        moveNode(BASE, { nodeId: '0.0', target: { nodeId: '0.6', position: 'first-child' } }),
      ),
    ).toBe('invalid-target')
    expect(
      errorOf(moveNode(BASE, { nodeId: '0.0', target: { nodeId: '0.3', position: 'before' } })),
    ).toBe('conditional-chain')
  })

  it('reorders slot templates only within their component', () => {
    const input = page(`  <Card>
    <template #a>A</template>
    <template #b>B</template>
  </Card>
  <Card></Card>`)
    expect(
      ok(moveNode(input, { nodeId: '0.1', target: { nodeId: '0.0', position: 'before' } })).code,
    ).toContain('<template #b>B</template>\n    <template #a>A</template>')
    expect(
      errorOf(moveNode(input, { nodeId: '0.1', target: { nodeId: '1', position: 'last-child' } })),
    ).toBe('invalid-target')
  })
})

describe('wrapNode', () => {
  it('wraps a multi-line element and re-indents it', () => {
    const result = ok(
      wrapNode(BASE, {
        nodeId: '0.1',
        wrapper: { tag: 'div', attributes: [{ name: 'class', value: 'row' }] },
      }),
    )
    expect(result.code).toContain(`    <div class="row">
      <Card
        title="A"
        :price="item.price * 2"
        @select="pick(item)"
      />
    </div>`)
    expect(result.nodeId).toBe('0.1')
  })

  it('wraps a v-for element (the wrapper is not repeated)', () => {
    const result = ok(wrapNode(BASE, { nodeId: '0.5.0', wrapper: { tag: 'div' } }))
    expect(result.code).toContain(`<div>
        <li v-for="i in items" :key="i.id">{{ i.name }}</li>
      </div>`)
  })

  it('keeps HTML out of inline SVG but allows rearranging SVG content', () => {
    const svg = page(`  <svg viewBox="0 0 10 10">
    <circle r="1" />
    <rect width="1" />
  </svg>
  <p>text</p>`)
    expect(
      errorOf(moveNode(svg, { nodeId: '1', target: { nodeId: '0.0', position: 'before' } })),
    ).toBe('invalid-target')
    expect(
      errorOf(
        insertNode(svg, { target: { nodeId: '0', position: 'last-child' }, node: { tag: 'div' } }),
      ),
    ).toBe('invalid-target')
    ok(moveNode(svg, { nodeId: '0.1', target: { nodeId: '0.0', position: 'before' } }))
  })

  it('refuses chains, slot templates and void wrappers', () => {
    expect(errorOf(wrapNode(BASE, { nodeId: '0.2', wrapper: { tag: 'div' } }))).toBe(
      'conditional-chain',
    )
    expect(errorOf(wrapNode(BASE, { nodeId: '0.0', wrapper: { tag: 'img' } }))).toBe('invalid-spec')
    const slots = page('  <Card>\n    <template #a>A</template>\n  </Card>')
    expect(errorOf(wrapNode(slots, { nodeId: '0.0', wrapper: { tag: 'div' } }))).toBe(
      'invalid-target',
    )
  })
})

describe('duplicateNode and setText', () => {
  it('duplicates an element right after itself', () => {
    const result = ok(duplicateNode(BASE, { nodeId: '0.0' }))
    expect(result.code).toContain('    <h1>Title</h1>\n    <h1>Title</h1>\n')
    expect(result.nodeId).toBe('0.1')
    expect(errorOf(duplicateNode(BASE, { nodeId: '0.4' }))).toBe('conditional-chain')
  })

  it('edits plain text and keeps surrounding whitespace', () => {
    const input = page('  <button>\n    Buy now\n  </button>')
    expect(ok(setText(input, { nodeId: '0', text: 'Pay <now>' })).code).toBe(
      page('  <button>\n    Pay &lt;now>\n  </button>'),
    )
    expect(ok(setText(page('  <p />'), { nodeId: '0', text: 'Hi' })).code).toBe(page('  <p>Hi</p>'))
  })

  it('refuses dynamic content instead of overwriting it', () => {
    expect(errorOf(setText(BASE, { nodeId: '0.5.0', text: 'x' }))).toBe('dynamic-content')
    expect(errorOf(setText(page('  <p>Hi {{ name }}</p>'), { nodeId: '0', text: 'x' }))).toBe(
      'dynamic-content',
    )
    expect(errorOf(setText(page('  <p v-html="raw" />'), { nodeId: '0', text: 'x' }))).toBe(
      'dynamic-content',
    )
    expect(errorOf(setText(BASE, { nodeId: '0.6', text: 'x' }))).toBe('invalid-target')
  })
})

describe('formatting and line endings', () => {
  it('works on CRLF files and irregular formatting', () => {
    const input = page(`	<div   class = "x"><span>a</span>
		<Card   title='t'/>
	</div>`).replace(/\n/g, '\r\n')
    const moved = ok(
      moveNode(input, { nodeId: '0.1', target: { nodeId: '0.0', position: 'before' } }),
    )
    expect(moved.code.includes('\r\n')).toBe(true)
    expect(moved.code.replace(/\r\n/g, '').includes('\n')).toBe(false)
    const inserted = ok(
      insertNode(input, { target: { nodeId: '0.1', position: 'after' }, node: { tag: 'b' } }),
    )
    expect(inserted.code).toContain(`<Card   title='t'/>\r\n\t\t<b></b>\r\n`)
  })

  it('never touches comments, scripts or styles', () => {
    const result = ok(removeNode(BASE, { nodeId: '0.5' }))
    expect(result.code).toContain('<!-- header -->')
    expect(result.code.slice(result.code.indexOf('<style'))).toBe(
      BASE.slice(BASE.indexOf('<style')),
    )
    expect(result.code.slice(0, result.code.indexOf('<template>'))).toBe(
      BASE.slice(0, BASE.indexOf('<template>')),
    )
  })
})

describe('blank lines between siblings', () => {
  const spaced = page(
    ['  <main>', '    <A />', '', '    <B />', '', '    <C />', '  </main>'].join(
      String.fromCharCode(10),
    ),
  )
  const lines = (code: string) =>
    code.slice(code.indexOf('<main>'), code.indexOf('</main>')).split(String.fromCharCode(10))

  it('removing an element between blank lines leaves a single blank line', () => {
    expect(lines(ok(removeNode(spaced, { nodeId: '0.1' })).code)).toEqual([
      '<main>',
      '    <A />',
      '',
      '    <C />',
      '  ',
    ])
  })

  it('moving keeps the blank-line rhythm', () => {
    const moved = ok(
      moveNode(spaced, { nodeId: '0.2', target: { nodeId: '0.0', position: 'before' } }),
    )
    expect(lines(moved.code)).toEqual([
      '<main>',
      '    <C />',
      '',
      '    <A />',
      '',
      '    <B />',
      '  ',
    ])
  })

  it('inserting between spaced siblings adds the separator', () => {
    const after = ok(
      insertNode(spaced, { target: { nodeId: '0.0', position: 'after' }, node: { tag: 'hr' } }),
    )
    expect(lines(after.code)).toEqual([
      '<main>',
      '    <A />',
      '',
      '    <hr />',
      '',
      '    <B />',
      '',
      '    <C />',
      '  ',
    ])
  })
})

describe('property check over real files', async () => {
  const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
  const example = fileURLToPath(new URL('../../../examples/basic-shop/src', import.meta.url))
  const files: string[] = []
  for (const dir of [fixtures, example]) {
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith('.vue'))
        files.push(path.join(entry.parentPath, entry.name))
    }
  }

  // Every operation on every element must either succeed with a valid result or be refused
  // cleanly — never fail verification (which would mean the engine produced a wrong edit).
  for (const file of files) {
    it(path.basename(file), async () => {
      const source = await readFile(file, 'utf8')
      const template = analyzeComponent(source, { filename: 'x.vue' }).template!
      const ids = [...walkElements(template)].map((e) => e.id)
      const results: TransformResult[] = []
      for (const nodeId of ids) {
        results.push(removeNode(source, { nodeId }))
        results.push(duplicateNode(source, { nodeId }))
        results.push(wrapNode(source, { nodeId, wrapper: { tag: 'div' } }))
        results.push(
          insertNode(source, {
            target: { nodeId, position: 'after' },
            node: { tag: 'span', text: 'x' },
          }),
        )
        results.push(
          insertNode(source, { target: { nodeId, position: 'last-child' }, node: { tag: 'span' } }),
        )
        for (const other of ids) {
          if (other !== nodeId)
            results.push(
              moveNode(source, { nodeId, target: { nodeId: other, position: 'before' } }),
            )
        }
      }
      const failures = results.filter((r) => !r.ok && r.error.code === 'verification-failed')
      expect(failures.map((r) => !r.ok && r.error.message)).toEqual([])
      expect(results.some((r) => r.ok)).toBe(true)
    })
  }
})
