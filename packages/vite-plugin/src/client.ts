/**
 * Browser runtime injected (dev only) into the app being edited.
 * It is inert unless the page runs inside the vuelume editor iframe.
 *
 * Responsibilities: resolve DOM elements to source locators, draw hover / selection / drop
 * overlays, run drag & drop inside the canvas, and talk to the editor through `postMessage`
 * (same origin only). It never edits anything itself: the editor turns drops into operations.
 */
import {
  BASE_PATH,
  decodeLocator,
  encodeLocator,
  fileHash,
  NODE_ATTRIBUTE,
  USAGE_ATTRIBUTE_PREFIX,
  type CanvasTarget,
  type DropPosition,
  type EditorToPreview,
  type NodeRef,
  type PreviewToEditor,
} from '@vuelume/project-model'

const VOID = new Set([
  'AREA',
  'BASE',
  'BR',
  'COL',
  'EMBED',
  'HR',
  'IMG',
  'INPUT',
  'LINK',
  'META',
  'SOURCE',
  'TRACK',
  'WBR',
])

export function resolveTarget(start: Element): CanvasTarget {
  const nodeElement = start.closest(`[${NODE_ATTRIBUTE}]`)
  const node = decodeLocator(nodeElement?.getAttribute(NODE_ATTRIBUTE))
  const usages: NodeRef[] = []
  const seen = new Set<string>()
  for (let el: Element | null = start; el; el = el.parentElement) {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith(USAGE_ATTRIBUTE_PREFIX) || seen.has(attr.value)) continue
      const locator = decodeLocator(attr.value)
      if (locator) {
        seen.add(attr.value)
        usages.push(locator)
      }
    }
  }
  return { node, usages }
}

/** All rendered elements for a locator (several for `v-for`, none for a false `v-if`). */
export function elementsFor(locator: NodeRef, root: ParentNode = document): Element[] {
  const value = CSS.escape(encodeLocator(locator))
  return Array.from(
    root.querySelectorAll(
      `[${NODE_ATTRIBUTE}="${value}"], [${USAGE_ATTRIBUTE_PREFIX}${fileHash(locator.file)}="${value}"]`,
    ),
  )
}

/** Default pick: the nearest component usage; `drill` selects the innermost native element. */
function pick(target: CanvasTarget, drill: boolean): NodeRef | null {
  return drill ? (target.node ?? target.usages[0] ?? null) : (target.usages[0] ?? target.node)
}

const same = (a: NodeRef | null, b: NodeRef | null) =>
  !!a && !!b && a.file === b.file && a.nodeId === b.nodeId

function start(): void {
  const editor = window.parent
  const post = (message: PreviewToEditor) => editor.postMessage(message, location.origin)

  const layer = document.createElement('div')
  layer.setAttribute('data-vuelume-overlay', '')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  document.documentElement.append(layer)

  let inspecting = false
  let paletteDrag = false
  let selected: NodeRef | null = null
  let selectedLabel = ''
  let hovered: NodeRef | null = null
  let drop: { target: NodeRef; position: DropPosition; element: Element } | null = null
  let pointerDrag: { x: number; y: number; active: boolean } | null = null
  let suppressClick = false

  const box = (r: DOMRect, css: string) => {
    const div = document.createElement('div')
    div.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;${css}`
    layer.append(div)
    return div
  }
  const chip = (r: DOMRect, text: string, color: string) => {
    const div = document.createElement('div')
    div.textContent = text
    const top = r.top > 20 ? r.top - 20 : r.bottom + 2
    div.style.cssText = `position:fixed;left:${r.left}px;top:${top}px;background:${color};color:#fff;font:600 11px/18px system-ui,sans-serif;padding:0 6px;border-radius:3px;white-space:nowrap`
    layer.append(div)
  }

  const draw = () => {
    layer.replaceChildren()
    if (hovered && inspecting && !same(hovered, selected) && !drop) {
      for (const el of elementsFor(hovered))
        box(el.getBoundingClientRect(), 'outline:1px solid #8b7cf6;background:#8b7cf614')
    }
    if (selected) {
      const elements = elementsFor(selected)
      elements.forEach((el, i) => {
        const r = el.getBoundingClientRect()
        box(r, 'outline:2px solid #7c5cff')
        if (i === 0 && selectedLabel) chip(r, selectedLabel, '#7c5cff')
      })
    }
    if (drop) {
      const r = drop.element.getBoundingClientRect()
      if (drop.position === 'inside') {
        box(r, 'outline:2px dashed #22c55e;background:#22c55e1a')
        chip(r, 'Drop inside', '#16a34a')
      } else {
        const horizontal = isRowLayout(drop.element)
        const edge = drop.position === 'before' ? 'start' : 'end'
        const line = horizontal
          ? new DOMRect(edge === 'start' ? r.left - 2 : r.right - 1, r.top, 3, r.height)
          : new DOMRect(r.left, edge === 'start' ? r.top - 2 : r.bottom - 1, r.width, 3)
        box(line, 'background:#22c55e;border-radius:2px')
        chip(r, drop.position === 'before' ? 'Drop before' : 'Drop after', '#16a34a')
      }
    }
  }

  /** Before/after follows the parent's flow direction (rows for flex-row / inline layouts). */
  function isRowLayout(el: Element): boolean {
    const parent = el.parentElement
    if (!parent) return false
    const style = getComputedStyle(parent)
    return (
      (style.display.includes('flex') && style.flexDirection.startsWith('row')) ||
      getComputedStyle(el).display.startsWith('inline')
    )
  }

  function dropAt(x: number, y: number, exclude: NodeRef | null): typeof drop {
    const hit = document.elementFromPoint(x, y)
    if (!hit) return null
    const target = pick(resolveTarget(hit), false)
    if (!target) return null
    if (
      exclude &&
      (same(target, exclude) ||
        (target.file === exclude.file && target.nodeId.startsWith(`${exclude.nodeId}.`)))
    ) {
      return null
    }
    const element = elementsFor(target).find((el) => el.contains(hit)) ?? elementsFor(target)[0]
    if (!element) return null
    const r = element.getBoundingClientRect()
    const horizontal = isRowLayout(element)
    const ratio = horizontal
      ? (x - r.left) / Math.max(r.width, 1)
      : (y - r.top) / Math.max(r.height, 1)
    const canContain =
      !VOID.has(element.tagName) && element.namespaceURI === 'http://www.w3.org/1999/xhtml'
    const position: DropPosition =
      canContain && ratio > 0.25 && ratio < 0.75 ? 'inside' : ratio < 0.5 ? 'before' : 'after'
    return { target, position, element }
  }

  document.addEventListener(
    'mousemove',
    (event) => {
      if (!inspecting || pointerDrag || !(event.target instanceof Element)) return
      hovered = pick(resolveTarget(event.target), event.altKey)
      draw()
    },
    true,
  )
  document.addEventListener(
    'click',
    (event) => {
      if (!inspecting || !(event.target instanceof Element)) return
      event.preventDefault()
      event.stopPropagation()
      if (suppressClick) {
        suppressClick = false
        return
      }
      const target = resolveTarget(event.target)
      if (event.altKey) target.usages = []
      post({ type: 'vuelume:select', target })
    },
    true,
  )

  // Drag the selected element inside the canvas (pointer based, so it works on any element).
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!inspecting || event.button !== 0 || !selected || !(event.target instanceof Element))
        return
      const target = pick(resolveTarget(event.target), event.altKey)
      if (!same(target, selected)) return
      pointerDrag = { x: event.clientX, y: event.clientY, active: false }
    },
    true,
  )
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!pointerDrag) return
      if (
        !pointerDrag.active &&
        Math.hypot(event.clientX - pointerDrag.x, event.clientY - pointerDrag.y) < 6
      )
        return
      pointerDrag.active = true
      event.preventDefault()
      document.documentElement.style.cursor = 'grabbing'
      drop = dropAt(event.clientX, event.clientY, selected)
      draw()
    },
    true,
  )
  document.addEventListener(
    'pointerup',
    () => {
      if (!pointerDrag) return
      const wasActive = pointerDrag.active
      pointerDrag = null
      document.documentElement.style.cursor = ''
      if (wasActive) {
        suppressClick = true
        if (drop && selected) {
          post({
            type: 'vuelume:drop',
            mode: 'move',
            target: drop.target,
            position: drop.position,
            source: selected,
          })
        }
      }
      drop = null
      draw()
    },
    true,
  )

  // Palette items dragged from the editor (HTML5 drag & drop across the same-origin iframe).
  document.addEventListener('dragover', (event) => {
    if (!paletteDrag) return
    event.preventDefault()
    drop = dropAt(event.clientX, event.clientY, null)
    draw()
  })
  document.addEventListener('dragleave', (event) => {
    if (paletteDrag && event.relatedTarget === null) {
      drop = null
      draw()
    }
  })
  document.addEventListener('drop', (event) => {
    if (!paletteDrag) return
    event.preventDefault()
    if (drop)
      post({ type: 'vuelume:drop', mode: 'insert', target: drop.target, position: drop.position })
    drop = null
    draw()
  })

  // Editor shortcuts keep working while the canvas has focus.
  document.addEventListener(
    'keydown',
    (event) => {
      if (!inspecting) return
      const editable =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
      if (editable) return
      const mod = event.ctrlKey || event.metaKey
      const handled =
        (mod && /^[zyd]$/i.test(event.key)) ||
        event.key === 'Delete' ||
        event.key === 'Backspace' ||
        event.key === 'Escape' ||
        (event.altKey && /^Arrow(Up|Down)$/.test(event.key))
      if (!handled) return
      event.preventDefault()
      post({
        type: 'vuelume:key',
        input: { key: event.key, mod, shift: event.shiftKey, alt: event.altKey },
      })
    },
    true,
  )

  for (const type of ['scroll', 'resize']) window.addEventListener(type, draw, true)
  new MutationObserver(() => requestAnimationFrame(draw)).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  })

  window.addEventListener('message', (event: MessageEvent<EditorToPreview>) => {
    if (event.origin !== location.origin || event.source !== editor) return
    const message = event.data
    if (message?.type === 'vuelume:inspect') {
      inspecting = message.enabled
      hovered = null
    } else if (message?.type === 'vuelume:highlight') {
      selected = message.target
      selectedLabel = message.label ?? ''
    } else if (message?.type === 'vuelume:drag') {
      paletteDrag = message.active
      if (!paletteDrag) drop = null
    } else return
    draw()
  })

  // Tell the editor when Vite applied an update, so the tree and inspector re-read the files —
  // including changes made in another editor.
  const hot = (
    import.meta as unknown as {
      hot?: { on(event: string, cb: (payload: { updates?: { path: string }[] }) => void): void }
    }
  ).hot
  hot?.on('vite:afterUpdate', (payload) => {
    const files = (payload.updates ?? []).map((u) => u.path.split('?')[0]!.replace(/^\//, ''))
    post({ type: 'vuelume:updated', files })
  })

  post({ type: 'vuelume:ready' })
}

function insideEditor(): boolean {
  try {
    return window.parent !== window && window.parent.location.pathname.startsWith(BASE_PATH)
  } catch {
    return false // cross-origin parent: never activate
  }
}

if (typeof window !== 'undefined' && insideEditor()) start()
