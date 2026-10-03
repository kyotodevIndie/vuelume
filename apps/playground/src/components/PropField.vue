<script setup lang="ts">
import type { EditValue, PropDefinition, TemplateAttribute } from '@vuelume/project-model'
import { computed } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{
  name: string
  attribute: TemplateAttribute | undefined
  definition: PropDefinition | undefined
}>()

const emit = defineEmits<{ set: [value: EditValue]; remove: []; open: [] }>()

/** Current value as written in the template, when it is a plain literal. */
const current = computed<EditValue | undefined>(() => {
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
const rawText = computed(() => {
  const attr = props.attribute
  if (!attr) return ''
  if (attr.kind === 'static')
    return attr.value === null ? attr.name : `${attr.name}="${attr.value}"`
  return `${attr.rawName}="${attr.expression ?? ''}"`
})

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
      <span>{{ name }}<span v-if="definition?.required" class="req" title="Required">*</span></span>
      <small v-if="definition">{{ definition.type.text }}</small>
    </label>

    <div v-if="readonly" class="readonly">
      <code>{{ rawText }}</code>
      <span class="warn-text">⚠ {{ attribute?.readonlyReason }}</span>
      <a href="#" @click.prevent="emit('open')">Open in code</a>
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
      <label v-else-if="kind === 'boolean'" class="switch">
        <input
          type="checkbox"
          :checked="current === true"
          @change="emit('set', ($event.target as HTMLInputElement).checked)"
        />
        <span>{{
          current === true ? 'true' : current === false ? 'false' : (definition?.default ?? 'unset')
        }}</span>
      </label>
      <input
        v-else
        :type="kind === 'number' ? 'number' : 'text'"
        :value="current ?? ''"
        :placeholder="definition?.default ?? ''"
        @change="commitText"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <button v-if="attribute" class="icon-button" title="Remove from code" @click="emit('remove')">
        <Icon name="close" :size="11" />
      </button>
    </div>
  </div>
</template>
