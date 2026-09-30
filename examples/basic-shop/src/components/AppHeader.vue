<script setup lang="ts">
// Vue 3.5 reactive props destructure with defaults.
const { title = 'Basic Shop', cartCount = 0 } = defineProps<{
  title?: string
  cartCount?: number
}>()

defineEmits(['open-cart'])
</script>

<template>
  <header class="header">
    <h1>{{ title }}</h1>
    <button type="button" @click="$emit('open-cart')">Cart ({{ cartCount }})</button>
  </header>
</template>
