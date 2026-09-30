<script setup lang="ts">
const query = defineModel<string>({ default: '' })

defineProps<{ placeholder?: string }>()
</script>

<template>
  <input v-model="query" type="search" :placeholder="placeholder" />
</template>
