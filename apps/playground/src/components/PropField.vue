<script setup lang="ts">
import type { PropDefinition, TemplateAttribute } from '@vuelume/project-model'
import { computed } from 'vue'
import type { PropValue } from '../api'

const props = defineProps<{
  name: string
  attribute: TemplateAttribute | undefined
  definition: PropDefinition | undefined
}>()

const emit = defineEmits<{ set: [value: PropValue]; remove: []; open: [] }>()

/** Current value as written in the template, when it is a plain literal. */
const current = computed<PropValue | undefined>(() => {
  const attr = props.attribute
  if (attr?.kind === 'static') return attr.value ?? true
  if (attr?.kind === 'bind' && attr.literal && 'value' in attr.literal) return attr.literal.value
  return undefined
})

const kind = computed(() => {
  const declared = props.definition?.type.kind
  if (declared === 'enum' || declared === 'boolean' || declared === 'number') return declared
  if (typeof current.value === 'boolean') return 'boolean'
  if (typeof current.value === 'number') return 'number'
  return 'string'
})

const readonly = computed(() => props.attribute !== undefined && !props.attribute.editable)

function commitText(event: Event) {
  const input = event.target as HTMLInputElement
  if (kind.value === 'number') {
    const value = Number(input.value)
    if (input.value.trim() !== '' && Number.isFinite(value) && value !== current.value)
      emit('set', value)
  } else if (input.value !== current.value) {
    emit('set', input.value)
  }
}

function commitEnum(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  const option = props.definition?.type.options?.find((o) => String(o) === raw)
  if (option !== undefined) emit('set', option)
}
</script>

<template>
  <div :class="['field', { absent: !attribute }]">
    <label
      :title="
        definition
          ? `${definition.name}${definition.required ? '' : '?'}: ${definition.type.text}`
          : undefined
      "
    >
      {{ name }}
      <small v-if="definition">{{ definition.type.text }}</small>
      <small v-else>attribute</small>
    </label>

    <div v-if="readonly" class="readonly">
      <code>{{
        attribute && 'rawName' in attribute
          ? `${attribute.rawName}="${attribute.expression ?? ''}"`
          : ''
      }}</code>
      <span class="warn">⚠ {{ attribute?.readonlyReason }} —</span>
      <a href="#" @click.prevent="emit('open')">open in code</a>
    </div>

    <div v-else class="control">
      <select
        v-if="kind === 'enum'"
        :value="current === undefined ? '' : String(current)"
        @change="commitEnum"
      >
        <option value="" disabled>{{ definition?.default ?? '—' }}</option>
        <option v-for="o in definition?.type.options" :key="String(o)" :value="String(o)">
          {{ o }}
        </option>
      </select>
      <input
        v-else-if="kind === 'boolean'"
        type="checkbox"
        :checked="current === true"
        @change="emit('set', ($event.target as HTMLInputElement).checked)"
      />
      <input
        v-else
        :type="kind === 'number' ? 'number' : 'text'"
        :value="current ?? ''"
        :placeholder="definition?.default ?? ''"
        @change="commitText"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <button v-if="attribute" class="remove" title="Remove from code" @click="emit('remove')">
        ×
      </button>
    </div>
  </div>
</template>
