<script setup lang="ts">
import { ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import Button from './components/Button.vue'
import ProductCard from './components/ProductCard.vue'
import ProductGrid from './components/ProductGrid.vue'
import SearchInput from './components/SearchInput.vue'
import StatusBadge from './components/StatusBadge.vue'
import LegacyNotice from './components/legacy/LegacyNotice.vue'
import type { Product } from './types'

const query = ref('')
const cart = ref<Product[]>([])
const products: Product[] = [
  { id: 1, name: 'Notebook', price: 4999, featured: true },
  { id: 2, name: 'Mouse', price: 149 },
  { id: 3, name: 'Keyboard', price: 399 },
]
</script>

<template>
  <AppHeader title="Basic Shop" :cart-count="cart.length" />

  <main class="page">
    <SearchInput v-model="query" placeholder="Search products" />

    <ProductCard
      title="Notebook"
      :price="4999"
      featured
      badge="new"
    />

    <Button
      variant="primary"
      size="large"
    >
      Buy now
    </Button>

    <ProductGrid :products="products" :columns="3" @select="cart.push($event)">
      <template #header>
        <h2>All products</h2>
      </template>
    </ProductGrid>

    <Transition name="fade">
      <StatusBadge v-if="cart.length > 0" label="In cart" tone="success" />
    </Transition>

    <LegacyNotice message="Prices in BRL" />
  </main>
</template>

<style>
.page { max-width: 960px; margin: 0 auto; display: grid; gap: 1.5rem; font-family: system-ui, sans-serif; }
</style>
