<script setup lang="ts">
import { computed } from 'vue'

// Runtime (object) props declaration.
const props = defineProps({
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BRL' },
})

const formatted = computed(() =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: props.currency }).format(props.amount),
)
</script>

<template>
  <strong class="price">{{ formatted }}</strong>
</template>
