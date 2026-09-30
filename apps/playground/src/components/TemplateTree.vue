<script setup lang="ts">
import type { NodeRef, TemplateChildNode, TemplateElementNode } from '@vuelume/project-model'
import { computed } from 'vue'

const props = defineProps<{
  file: string
  nodes: TemplateChildNode[]
  selected: NodeRef | null
  depth?: number
}>()

const emit = defineEmits<{ select: [ref: NodeRef] }>()

const elements = computed(() =>
  props.nodes.filter((n): n is TemplateElementNode => n.type === 'element'),
)
const isSelected = (el: TemplateElementNode) =>
  props.selected?.file === props.file && props.selected.nodeId === el.id
</script>

<template>
  <ul class="tree">
    <li v-for="el in elements" :key="el.id">
      <button
        :class="['node', el.elementType, { selected: isSelected(el) }]"
        :style="{ paddingLeft: `${(depth ?? 0) * 12 + 6}px` }"
        :title="`${file}:${el.range.start.line}:${el.range.start.column}`"
        @click="emit('select', { file, nodeId: el.id })"
      >
        &lt;{{ el.tag }}&gt;
        <span v-for="flag in el.flags" :key="flag" class="flag">{{ flag }}</span>
      </button>
      <TemplateTree
        v-if="el.children.some((c) => c.type === 'element')"
        :file="file"
        :nodes="el.children"
        :selected="selected"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>
