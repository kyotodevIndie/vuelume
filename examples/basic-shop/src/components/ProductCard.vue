<script setup lang="ts">
import PriceTag from './PriceTag.vue'

interface Props {
  title: string
  price: number
  featured?: boolean
  badge?: 'new' | 'sale'
}

withDefaults(defineProps<Props>(), {
  featured: false,
})

defineEmits<{ select: [title: string] }>()
</script>

<template>
  <article class="card" :class="{ 'card--featured': featured }" @click="$emit('select', title)">
    <span v-if="badge" class="card__badge">{{ badge }}</span>
    <h3>{{ title }}</h3>
    <PriceTag :amount="price" />
  </article>
</template>

<style scoped>
.card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
.card--featured { border-color: #f5a623; box-shadow: 0 0 0 2px #f5a62333; }
.card__badge { font-size: 0.7rem; text-transform: uppercase; color: #c0392b; }
</style>
