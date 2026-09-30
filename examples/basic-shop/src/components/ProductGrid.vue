<script setup lang="ts">
import type { Product } from '../types'
import ProductCard from './ProductCard.vue'

defineProps<{
  products: Product[]
  columns?: 2 | 3 | 4
}>()

const emit = defineEmits<{ select: [product: Product] }>()
</script>

<template>
  <section class="grid" :style="{ gridTemplateColumns: `repeat(${columns ?? 3}, 1fr)` }">
    <slot name="header" />
    <ProductCard
      v-for="product in products"
      :key="product.id"
      :title="product.name"
      :price="product.price"
      :featured="product.featured"
      @select="emit('select', product)"
    />
    <slot v-if="products.length === 0" name="empty">No products.</slot>
  </section>
</template>

<style scoped>
.grid { display: grid; gap: 1rem; }
</style>
