<script setup lang="ts">
import type { TemplateElementNode } from '@vuelume/project-model'
import { computed, ref } from 'vue'
import { run } from '../editor'
import Icon from './Icon.vue'

// Edits the static `class` attribute as a list of tokens. A bound `:class` is merged by Vue and
// is shown read-only (it is never rewritten).
const props = defineProps<{ file: string; element: TemplateElementNode }>()

const staticClass = computed(() =>
  props.element.attributes.find((a) => a.kind === 'static' && a.name === 'class'),
)
const bound = computed(() =>
  props.element.attributes.find((a) => a.kind === 'bind' && a.name === 'class'),
)
const tokens = computed(() =>
  staticClass.value?.kind === 'static'
    ? (staticClass.value.value ?? '').split(/\s+/).filter(Boolean)
    : [],
)
const editable = computed(() => !staticClass.value || staticClass.value.editable)
const draft = ref('')

async function write(next: string[]) {
  const nodeId = props.element.id
  if (next.length === 0) await run(props.file, { op: 'removeProp', nodeId, name: 'class' })
  else await run(props.file, { op: 'setProp', nodeId, name: 'class', value: next.join(' ') })
}

async function add() {
  const added = draft.value.split(/\s+/).filter((t) => t && !tokens.value.includes(t))
  draft.value = ''
  if (added.length) await write([...tokens.value, ...added])
}
</script>

<template>
  <div class="class-editor">
    <div class="chips">
      <span v-for="token in tokens" :key="token" class="chip">
        {{ token }}
        <button
          v-if="editable"
          title="Remove class"
          @click="write(tokens.filter((t) => t !== token))"
        >
          <Icon name="close" :size="10" />
        </button>
      </span>
      <input
        v-if="editable"
        v-model="draft"
        class="chip-input"
        placeholder="Add class…"
        @keydown.enter.prevent="add"
        @blur="add"
      />
    </div>
    <p v-if="!editable" class="warn-text">
      ⚠ {{ staticClass?.readonlyReason }} — edit classes in code.
    </p>
    <p v-if="bound && bound.kind === 'bind'" class="note">
      Dynamic <code>:class="{{ bound.expression }}"</code> is merged at runtime (read-only).
    </p>
  </div>
</template>
