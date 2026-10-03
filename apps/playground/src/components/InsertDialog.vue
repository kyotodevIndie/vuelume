<script setup lang="ts">
import type { EditValue } from '@vuelume/project-model'
import { onMounted, reactive, ref } from 'vue'
import { insertItem, state } from '../editor'
import { initialValue } from '../palette'

// Asks for the required props of a component before inserting it: the editor never invents
// values on its own.
const pending = state.pending!
const values = reactive<Record<string, EditValue>>(
  Object.fromEntries(pending.item.required.map((p) => [p.name, initialValue(p)])),
)
const first = ref<HTMLInputElement | null>(null)
onMounted(() => first.value?.focus())

async function submit() {
  const attributes = pending.item.required.map((p) => ({ name: p.name, value: values[p.name]! }))
  state.pending = null
  await insertItem(pending.item, pending.file, pending.target, attributes)
}
</script>

<template>
  <div
    class="dialog-backdrop"
    @click.self="state.pending = null"
    @keydown.esc="state.pending = null"
  >
    <form class="dialog" @submit.prevent="submit">
      <h2>Insert &lt;{{ pending.item.label }}&gt;</h2>
      <p class="muted">This component has required props. Provide their values:</p>
      <label v-for="(prop, index) in pending.item.required" :key="prop.name" class="dialog-field">
        <span
          >{{ prop.name }} <code>{{ prop.type.text }}</code></span
        >
        <select v-if="prop.type.kind === 'enum'" v-model="values[prop.name]">
          <option v-for="o in prop.type.options" :key="String(o)" :value="o">{{ o }}</option>
        </select>
        <input
          v-else-if="prop.type.kind === 'boolean'"
          v-model="values[prop.name]"
          type="checkbox"
        />
        <input
          v-else-if="prop.type.kind === 'number'"
          :ref="index === 0 ? (el) => (first = el as HTMLInputElement) : undefined"
          v-model.number="values[prop.name]"
          type="number"
          required
        />
        <input
          v-else
          :ref="index === 0 ? (el) => (first = el as HTMLInputElement) : undefined"
          v-model="values[prop.name]"
          type="text"
        />
      </label>
      <div class="dialog-actions">
        <button type="button" class="ghost" @click="state.pending = null">Cancel</button>
        <button type="submit" class="primary">Insert</button>
      </div>
    </form>
  </div>
</template>
