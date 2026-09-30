<script setup lang="ts">
defineProps<{
  variant: string
  size?: "small" | "medium" | "large"
  disabled?: boolean
}>()

defineEmits<{ (e: 'click', event: MouseEvent): void }>()
</script>

<template>
  <button
    class="btn"
    :class="[`btn--${variant}`, size && `btn--${size}`]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn { padding: 0.4rem 0.9rem; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; }
.btn--primary { background: #2f6fed; color: white; border-color: #2f6fed; }
.btn--small { font-size: 0.8rem; }
.btn--large { font-size: 1.2rem; }
</style>
