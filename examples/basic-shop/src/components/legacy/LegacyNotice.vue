<script>
// Options API: detected, not analyzed yet.
export default {
  name: 'LegacyNotice',
  props: {
    message: { type: String, required: true },
  },
}
</script>

<template>
  <p class="notice">{{ message }}</p>
</template>
