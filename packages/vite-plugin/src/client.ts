/**
 * Browser runtime injected (dev only) into the app being edited.
 * It is inert unless the page runs inside the vuelume editor iframe.
 *
 * Responsibilities: resolve DOM elements to source locators, draw hover/selection overlays and
 * talk to the editor through `postMessage` (same origin only).
 */
import {
  BASE_PATH,
  decodeLocator,
  encodeLocator,
  fileHash,
  NODE_ATTRIBUTE,
  USAGE_ATTRIBUTE_PREFIX,
  type CanvasTarget,
  type EditorToPreview,
  type NodeRef,
  type PreviewToEditor,
} from '@vuelume/project-model'

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

function start(): void {
  const editor = window.parent
  const post = (message: PreviewToEditor) => editor.postMessage(message, location.origin)

  const layer = document.createElement('div')
  layer.setAttribute('data-vuelume-overlay', '')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  document.documentElement.append(layer)

  let inspecting = false
  let selected: NodeRef | null = null
  let hovered: NodeRef | null = null

  const draw = () => {
    layer.replaceChildren()
    const box = (el: Element, color: string, fill: string) => {
      const r = el.getBoundingClientRect()
      const div = document.createElement('div')
      div.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid ${color};background:${fill};border-radius:2px`
      layer.append(div)
    }
    if (hovered && inspecting)
      for (const el of elementsFor(hovered)) box(el, '#7aa2f7', '#7aa2f714')
    if (selected) for (const el of elementsFor(selected)) box(el, '#f7768e', 'transparent')
  }

  // Default pick: the nearest component usage (what users think of as "the component"),
  // Alt+click drills down to the innermost native element.
  const pick = (target: CanvasTarget, drill: boolean) =>
    drill ? (target.node ?? target.usages[0] ?? null) : (target.usages[0] ?? target.node)

  document.addEventListener(
    'mousemove',
    (event) => {
      if (!inspecting || !(event.target instanceof Element)) return
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
      const target = resolveTarget(event.target)
      if (event.altKey) target.usages = []
      post({ type: 'vuelume:select', target })
    },
    true,
  )
  for (const type of ['scroll', 'resize']) window.addEventListener(type, draw, true)
  // Re-draw after HMR updates or any DOM change.
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
    } else return
    draw()
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
