<script setup lang="ts">
// Props typed with an interface imported from another file.
// The analyzer reports this as "not resolved yet" instead of guessing.
import type { BadgeProps } from '../types'

defineProps<BadgeProps>()
</script>

<template>
  <span class="badge" :data-tone="tone">{{ label }}</span>
</template>
