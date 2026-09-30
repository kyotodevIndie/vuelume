<script setup>
import DataTable from './DataTable.vue'
import Column from './Column.vue'
const rows = []
const attrs = { a: 1 }
</script>

<template>
  <DataTable :rows="rows" v-bind="attrs" striped>
    <template #header="{ title }">
      <h2 class="title">{{ title }}</h2>
    </template>
    <Column field="name" header="Name" :sortable="true" />
    <Column field="price" header="Price" :[dynamicAttr]="1" />
    <template v-slot:empty>
      <p class="empty">Nothing here</p>
    </template>
  </DataTable>
  <component :is="'div'" class="dyn" />
  <KeepAlive><RouterView /></KeepAlive>
  <input v-model.trim="query" name="q" v-custom:arg.mod="value" />
</template>
