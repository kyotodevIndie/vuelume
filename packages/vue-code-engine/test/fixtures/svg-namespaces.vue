<!-- Reduced from real-world components (element-plus, vue-vben-admin, primevue). -->
<template>
  <svg
    viewBox="0 0 79 86"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xml:space="preserve"
  >
    <defs>
      <linearGradient :id="`linearGradient-1-${id}`" x1="38.8503086%" y1="0%">
        <stop :stop-color="`var(--el-empty-fill-color-1)`" offset="0%" />
      </linearGradient>
    </defs>
    <use xlink:href="#path-1" fill-rule="evenodd" />
  </svg>
  <!-- PrimeVue pass-through attributes use several colon-separated segments. -->
  <Dialog pt:root:class="border-0" pt:mask:class="backdrop-blur-sm" modal />
</template>

<script lang="ts" setup>
import Dialog from 'primevue/dialog'
const id = 'x'
</script>
