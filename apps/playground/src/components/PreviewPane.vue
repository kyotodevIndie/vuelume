<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { frame, state } from '../editor'

const WIDTHS = { desktop: null, tablet: 768, mobile: 390 } as const
const width = computed(() => WIDTHS[state.device])
const iframe = ref<HTMLIFrameElement | null>(null)
onMounted(() => (frame.value = iframe.value))
</script>

<template>
  <main :class="['preview', state.device, { dragging: !!state.drag }]">
    <div class="device" :style="width ? { width: `${width}px` } : undefined">
      <iframe ref="iframe" src="/" title="Live preview of the application" />
    </div>
  </main>
</template>
