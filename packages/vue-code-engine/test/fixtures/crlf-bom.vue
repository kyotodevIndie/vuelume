<script setup lang="ts">
import Card from './Card.vue'
</script>

<template>
  <section class="list">
    <Card
      title="Windows file"
      :count="1"
    />
    <Card title="inline" subtitle="x" />
  </section>
</template>
