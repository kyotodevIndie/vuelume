/**
 * Custom drag image for HTML5 drags (palette items and layers): a small "card" with the tag,
 * instead of the browser's translucent screenshot. It follows the cursor across the editor and
 * into the preview iframe (the browser draws drag images above every frame).
 */
export function setDragGhost(
  event: DragEvent,
  label: string,
  kind: 'component' | 'element' | 'move',
): void {
  const transfer = event.dataTransfer
  if (!transfer) return
  const ghost = document.createElement('div')
  ghost.className = `drag-ghost ${kind}`
  const icon = document.createElement('span')
  icon.className = 'drag-ghost-icon'
  icon.textContent = kind === 'component' ? '◆' : kind === 'move' ? '⠿' : '</>'
  const text = document.createElement('span')
  text.textContent = label
  const hint = document.createElement('small')
  hint.textContent = kind === 'move' ? 'Moving' : 'Insert'
  ghost.append(icon, text, hint)
  document.body.append(ghost)
  transfer.setDragImage(ghost, 16, 16)
  // The browser snapshots the element synchronously; it can be removed right after.
  requestAnimationFrame(() => ghost.remove())
}
