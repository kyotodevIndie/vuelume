/**
 * Browser runtime injected (dev only) into the app being edited.
 * It is inert unless the page runs inside the vuelume editor iframe.
 *
 * Responsibilities: resolve DOM elements to source locators, draw hover / selection / drop
 * overlays, run drag & drop inside the canvas (with a "lifted" ghost of the dragged element),
 * and talk to the editor through `postMessage` (same origin only). It never edits anything
 * itself: the editor turns drops into operations.
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

const ACCENT = '#7c5cff'
const DROP = '#22c55e'

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

const OVERLAY_CSS = `
[data-vuelume-overlay] { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
[data-vuelume-overlay] * { box-sizing: border-box; }
.vl-chip { position: fixed; color: #fff; font: 600 11px/18px system-ui, sans-serif; padding: 0 6px;
  border-radius: 4px; white-space: nowrap; box-shadow: 0 2px 6px #0003; }
.vl-indicator { position: fixed; opacity: 0; border-radius: 3px;
  transition: left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease, opacity 120ms ease; }
.vl-indicator.line { background: ${DROP}; box-shadow: 0 0 0 3px ${DROP}33; }
.vl-indicator.line::before, .vl-indicator.line::after { content: ''; position: absolute; width: 8px; height: 8px;
  border-radius: 50%; background: ${DROP}; top: 50%; left: 0; transform: translate(-50%, -50%); }
.vl-indicator.line::after { left: 100%; }
.vl-indicator.line.vertical::before { top: 0; left: 50%; }
.vl-indicator.line.vertical::after { top: 100%; left: 50%; }
.vl-indicator.inside { outline: 2px dashed ${DROP}; background: ${DROP}1f; animation: vl-breathe 1s ease-in-out infinite; }
.vl-indicator .vl-chip { background: #16a34a; left: 0; top: -22px; position: absolute; }
.vl-origin { position: fixed; outline: 2px dashed ${ACCENT}aa; border-radius: 3px;
  background: repeating-linear-gradient(45deg, ${ACCENT}1a 0 6px, transparent 6px 12px); }
.vl-ghost { position: fixed; left: 0; top: 0; transform-origin: 0 0; will-change: transform;
  transition: transform 90ms ease-out, opacity 160ms ease; opacity: .95; }
.vl-ghost-card { overflow: hidden; border-radius: 8px; background: #fff;
  box-shadow: 0 18px 40px #0005, 0 0 0 2px ${ACCENT}; }
.vl-ghost-card > * { transform-origin: 0 0; }
.vl-ghost.lifting { transition: transform 180ms cubic-bezier(.2,.9,.3,1.3), opacity 160ms ease; }
.vl-ghost.landing { transition: transform 200ms ease-in, opacity 200ms ease-in; opacity: 0; }
.vl-ghost .vl-chip { position: absolute; top: -24px; left: 0; background: ${ACCENT}; }
.vl-ghost.invalid .vl-ghost-card { box-shadow: 0 18px 40px #0005, 0 0 0 2px #ef4444; }
.vl-ghost.invalid .vl-chip { background: #ef4444; }
.vl-indicator.invalid { outline: 2px dashed #ef4444; background: #ef444414; animation: none; }
.vl-indicator.invalid .vl-chip { background: #dc2626; }
.vl-pulse { position: fixed; border-radius: 4px; animation: vl-pulse 650ms ease-out forwards; }
@keyframes vl-pulse { from { box-shadow: 0 0 0 0 ${ACCENT}cc; outline: 2px solid ${ACCENT}; }
  to { box-shadow: 0 0 0 14px ${ACCENT}00; outline: 2px solid ${ACCENT}00; } }
@keyframes vl-breathe { 50% { background: ${DROP}33; } }
@media (prefers-reduced-motion: reduce) {
  .vl-ghost, .vl-indicator { transition: none !important; }
  .vl-pulse, .vl-indicator.inside { animation: none; }
}
`

function start(): void {
  const editor = window.parent
  const post = (message: PreviewToEditor) => editor.postMessage(message, location.origin)

  // Overlay: persistent layers so indicator / ghost can animate between frames.
  const root = document.createElement('div')
  root.setAttribute('data-vuelume-overlay', '')
  const style = document.createElement('style')
  style.textContent = OVERLAY_CSS
  const boxes = document.createElement('div')
  const indicator = document.createElement('div')
  indicator.className = 'vl-indicator'
  const indicatorChip = document.createElement('div')
  indicatorChip.className = 'vl-chip'
  indicator.append(indicatorChip)
  const effects = document.createElement('div')
  root.append(style, boxes, indicator, effects)
  document.documentElement.append(root)

  let inspecting = false
  let paletteDrag = false
  let selected: NodeRef | null = null
  let selectedLabel = ''
  let hovered: NodeRef | null = null
  let drop: {
    target: NodeRef
    position: DropPosition
    element: Element
    /** Why the drop is not allowed (shown in red; dropping cancels). */
    invalid?: string
  } | null = null
  let pointerDrag: PointerDrag | null = null
  let suppressClick = false

  interface PointerDrag {
    x: number
    y: number
    active: boolean
    /** Where inside the element the user grabbed it (keeps the ghost under the cursor). */
    offsetX: number
    offsetY: number
    source: Element
    ghost: HTMLElement | null
    scale: number
    label: string
    /** Latest pointer position (deferred frames must never use stale coordinates). */
    lastX: number
    lastY: number
  }

  const place = (el: HTMLElement, r: DOMRect) => {
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
  }
  const box = (r: DOMRect, css: string, className = '') => {
    const div = document.createElement('div')
    if (className) div.className = className
    div.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;${css}`
    boxes.append(div)
    return div
  }
  const chip = (r: DOMRect, text: string, color: string) => {
    const div = document.createElement('div')
    div.className = 'vl-chip'
    div.textContent = text
    div.style.left = `${r.left}px`
    div.style.top = `${r.top > 20 ? r.top - 20 : r.bottom + 2}px`
    div.style.background = color
    boxes.append(div)
  }

  const draw = () => {
    boxes.replaceChildren()
    const dragging = pointerDrag?.active === true
    if (hovered && inspecting && !same(hovered, selected) && !drop && !dragging) {
      for (const el of elementsFor(hovered)) {
        box(el.getBoundingClientRect(), `outline:1px solid #8b7cf6;background:#8b7cf614`)
      }
    }
    if (selected) {
      elementsFor(selected).forEach((el, i) => {
        const r = el.getBoundingClientRect()
        if (dragging) {
          box(r, '', 'vl-origin')
        } else {
          box(r, `outline:2px solid ${ACCENT}`)
          if (i === 0 && selectedLabel) chip(r, selectedLabel, ACCENT)
        }
      })
    }
    drawIndicator()
  }

  function drawIndicator() {
    if (!drop) {
      indicator.style.opacity = '0'
      pointerDrag?.ghost?.classList.remove('invalid')
      return
    }
    const r = drop.element.getBoundingClientRect()
    indicator.style.opacity = '1'
    pointerDrag?.ghost?.classList.toggle('invalid', !!drop.invalid)
    if (drop.invalid) {
      indicator.className = 'vl-indicator invalid'
      place(indicator, r)
      indicatorChip.textContent = drop.invalid
      return
    }
    if (drop.position === 'inside') {
      indicator.className = 'vl-indicator inside'
      place(indicator, r)
      indicatorChip.textContent = 'Drop inside'
      return
    }
    const horizontal = isRowLayout(drop.element)
    const before = drop.position === 'before'
    const line = horizontal
      ? new DOMRect(before ? r.left - 2 : r.right - 1, r.top, 3, r.height)
      : new DOMRect(r.left, before ? r.top - 2 : r.bottom - 1, r.width, 3)
    indicator.className = `vl-indicator line${horizontal ? ' vertical' : ''}`
    place(indicator, line)
    indicatorChip.textContent = before ? 'Drop before' : 'Drop after'
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
    if (!hit || root.contains(hit)) return null
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

  // Ghost ------------------------------------------------------------------------------------

  /**
   * A visual copy of the dragged element (without locator attributes, so it is never "found").
   * Large elements are scaled down to a readable size and cropped, never squashed.
   */
  function createGhost(source: Element, label: string): { ghost: HTMLElement; scale: number } {
    const r = source.getBoundingClientRect()
    const clone = source.cloneNode(true) as HTMLElement
    const strip = (el: Element) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('data-vl') || attr.name === 'id') el.removeAttribute(attr.name)
      }
      for (const child of Array.from(el.children)) strip(child)
    }
    strip(clone)
    // Keep the look of the root even when its CSS depends on ancestors.
    const computed = getComputedStyle(source)
    for (const property of [
      'background',
      'color',
      'font',
      'padding',
      'border',
      'border-radius',
      'display',
      'text-align',
      'line-height',
      'box-shadow',
    ]) {
      clone.style.setProperty(property, computed.getPropertyValue(property))
    }
    clone.style.margin = '0'
    clone.style.width = `${r.width}px`
    clone.style.height = `${r.height}px`
    clone.style.boxSizing = 'border-box'

    // Shrink big elements, but not below 60%: past that, crop instead.
    const scale = Math.max(
      0.6,
      Math.min(1, 360 / Math.max(r.width, 1), 240 / Math.max(r.height, 1)),
    )
    clone.style.transform = `scale(${scale})`
    const card = document.createElement('div')
    card.className = 'vl-ghost-card'
    card.style.width = `${Math.min(r.width * scale, 360)}px`
    card.style.height = `${Math.min(r.height * scale, 240)}px`
    card.append(clone)

    const ghost = document.createElement('div')
    ghost.className = 'vl-ghost lifting'
    ghost.style.transform = `translate(${r.left}px, ${r.top}px)`
    const tag = document.createElement('div')
    tag.className = 'vl-chip'
    tag.textContent = label
    ghost.append(card, tag)
    effects.append(ghost)
    return { ghost, scale }
  }

  function moveGhost(drag: PointerDrag, x: number, y: number) {
    if (!drag.ghost) return
    // Keep the grab point under the cursor (clamped to the visible, possibly cropped, card).
    const left = x - Math.min(drag.offsetX * drag.scale, 340)
    const top = y - Math.min(drag.offsetY * drag.scale, 220)
    drag.ghost.style.transform = `translate(${left}px, ${top}px) rotate(-1.5deg)`
  }

  /** Flies the ghost to the drop target (or back home when cancelled), then removes it. */
  function landGhost(drag: PointerDrag, to: Element | null) {
    const ghost = drag.ghost
    if (!ghost) return
    const r = (to ?? drag.source).getBoundingClientRect()
    ghost.classList.remove('lifting')
    ghost.classList.add('landing')
    ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(${to ? 0.6 : 1 / drag.scale})`
    setTimeout(() => ghost.remove(), 220)
  }

  function pulse(locator: NodeRef) {
    const [el] = elementsFor(locator)
    if (!el) return
    const div = document.createElement('div')
    div.className = 'vl-pulse'
    place(div, el.getBoundingClientRect())
    effects.append(div)
    setTimeout(() => div.remove(), 700)
  }

  // Events -----------------------------------------------------------------------------------

  document.addEventListener(
    'mousemove',
    (event) => {
      if (!inspecting || pointerDrag || !(event.target instanceof Element)) return
      if (root.contains(event.target)) return
      hovered = pick(resolveTarget(event.target), event.altKey)
      // A "grab" cursor tells the user the selected element can be dragged.
      document.documentElement.style.cursor = same(hovered, selected) ? 'grab' : ''
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
      if (!inspecting || event.button !== 0 || !selected || !(event.target instanceof Element)) {
        return
      }
      const target = pick(resolveTarget(event.target), event.altKey)
      if (!same(target, selected)) return
      const source =
        elementsFor(selected).find((el) => el.contains(event.target as Node)) ??
        elementsFor(selected)[0]
      if (!source) return
      const r = source.getBoundingClientRect()
      pointerDrag = {
        x: event.clientX,
        y: event.clientY,
        active: false,
        offsetX: event.clientX - r.left,
        offsetY: event.clientY - r.top,
        source,
        ghost: null,
        scale: 1,
        label: '',
        lastX: event.clientX,
        lastY: event.clientY,
      }
    },
    true,
  )
  document.addEventListener(
    'pointermove',
    (event) => {
      const drag = pointerDrag
      if (!drag) return
      if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return
      event.preventDefault()
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      if (!drag.active) {
        drag.active = true
        const { ghost, scale } = createGhost(drag.source, `Moving ${selectedLabel || 'element'}`)
        drag.ghost = ghost
        drag.scale = scale
        document.documentElement.style.cursor = 'grabbing'
        // Let the "lift" transition start from the element's own position.
        requestAnimationFrame(() => moveGhost(drag, drag.lastX, drag.lastY))
        setTimeout(() => ghost.classList.remove('lifting'), 200)
      } else {
        moveGhost(drag, event.clientX, event.clientY)
      }
      drop = dropAt(event.clientX, event.clientY, selected)
      // Moves are same-file operations; say so before the user lets go.
      if (drop && selected && drop.target.file !== selected.file) {
        drop.invalid = `Can't move into ${drop.target.file.split('/').pop()}`
      }
      draw()
    },
    true,
  )
  document.addEventListener(
    'pointerup',
    () => {
      const drag = pointerDrag
      if (!drag) return
      pointerDrag = null
      document.documentElement.style.cursor = ''
      if (drag.active) {
        suppressClick = true
        landGhost(drag, drop && !drop.invalid ? drop.element : null)
        if (drop && !drop.invalid && selected) {
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
  window.addEventListener('blur', () => {
    if (!pointerDrag) return
    landGhost(pointerDrag, null)
    pointerDrag = null
    drop = null
    draw()
  })

  // Palette items dragged from the editor (HTML5 drag & drop across the same-origin iframe).
  // The browser draws the dragged item itself (the editor sets a custom drag image).
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
    if (drop) {
      post({ type: 'vuelume:drop', mode: 'insert', target: drop.target, position: drop.position })
    }
    drop = null
    draw()
  })

  // Editor shortcuts keep working while the canvas has focus.
  document.addEventListener(
    'keydown',
    (event) => {
      if (!inspecting) return
      if (event.key === 'Escape' && pointerDrag) {
        landGhost(pointerDrag, null)
        pointerDrag = null
        drop = null
        draw()
        return
      }
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
      if (!inspecting) document.documentElement.style.cursor = ''
    } else if (message?.type === 'vuelume:highlight') {
      const changed = !same(selected, message.target)
      selected = message.target
      selectedLabel = message.label ?? ''
      // A short pulse draws the eye to a newly selected (e.g. just inserted/moved) element.
      // HMR may still be re-rendering, so wait a frame or two for the element to exist.
      if (changed && selected) {
        const target = selected
        setTimeout(() => pulse(target), 120)
      }
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
