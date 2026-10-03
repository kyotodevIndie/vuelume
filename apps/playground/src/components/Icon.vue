<script setup lang="ts">
// Small inline icon set (stroke icons, 24x24 grid) — no icon dependency needed.
const PATHS: Record<string, string> = {
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
  tablet: 'M6 2h12v20H6zM11 18h2',
  mobile: 'M8 2h8v20H8zM11 18h2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  wrap: 'M4 4h16v16H4zM8 8h8v8H8z',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  cursor: 'M5 3l14 7-6 2-2 6z',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5',
  chevron: 'm9 6 6 6-6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  component: 'M12 2 3 7v10l9 5 9-5V7z',
  element: 'M4 6h16M4 12h16M4 18h10',
  template: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  slot: 'M4 8h16v8H4z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-10',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
}

defineProps<{ name: keyof typeof PATHS | string; size?: number }>()
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name] ?? ''" />
  </svg>
</template>
