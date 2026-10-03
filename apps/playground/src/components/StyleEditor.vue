<script setup lang="ts">
import type { TemplateElementNode } from '@vuelume/project-model'
import { computed, ref } from 'vue'
import { parseDeclarations, serializeDeclarations } from '../css'
import { run } from '../editor'
import Icon from './Icon.vue'

// Edits the static inline `style` attribute as declarations. `:style` is merged by Vue and is
// shown read-only.
const props = defineProps<{ file: string; element: TemplateElementNode }>()

const staticStyle = computed(() =>
  props.element.attributes.find((a) => a.kind === 'static' && a.name === 'style'),
)
const bound = computed(() =>
  props.element.attributes.find((a) => a.kind === 'bind' && a.name === 'style'),
)
const editable = computed(() => !staticStyle.value || staticStyle.value.editable)

const declarations = computed(() =>
  staticStyle.value?.kind === 'static' ? parseDeclarations(staticStyle.value.value ?? '') : [],
)
const newProperty = ref('')
const newValue = ref('')

async function write(next: [string, string][]) {
  const nodeId = props.element.id
  const text = serializeDeclarations(next)
  if (!text) await run(props.file, { op: 'removeProp', nodeId, name: 'style' })
  else await run(props.file, { op: 'setProp', nodeId, name: 'style', value: text })
}

function update(index: number, value: string) {
  const next = declarations.value.map((d) => [...d] as [string, string])
  if (next[index]![1] === value.trim()) return
  next[index]![1] = value.trim()
  void write(next)
}

async function add() {
  if (!newProperty.value.trim() || !newValue.value.trim()) return
  await write([...declarations.value, [newProperty.value.trim(), newValue.value.trim()]])
  newProperty.value = ''
  newValue.value = ''
}
</script>

<template>
  <div class="style-editor">
    <div v-for="([property, value], index) in declarations" :key="property + index" class="decl">
      <span class="prop">{{ property }}</span>
      <input
        :value="value"
        :disabled="!editable"
        @change="update(index, ($event.target as HTMLInputElement).value)"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <button
        v-if="editable"
        class="icon-button"
        title="Remove declaration"
        @click="write(declarations.filter((_, i) => i !== index))"
      >
        <Icon name="close" :size="11" />
      </button>
    </div>
    <form v-if="editable" class="decl new" @submit.prevent="add">
      <input v-model="newProperty" placeholder="property" aria-label="CSS property" />
      <input v-model="newValue" placeholder="value" aria-label="CSS value" />
      <button class="icon-button" type="submit" title="Add declaration">
        <Icon name="plus" :size="12" />
      </button>
    </form>
    <p v-if="!editable" class="warn-text">
      ⚠ {{ staticStyle?.readonlyReason }} — edit styles in code.
    </p>
    <p v-if="bound && bound.kind === 'bind'" class="note">
      Dynamic <code>:style="{{ bound.expression }}"</code> is merged at runtime (read-only).
    </p>
  </div>
</template>
