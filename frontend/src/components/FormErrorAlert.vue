<script setup lang="ts">
/**
 * The red box at the top of a form: what went wrong, in one sentence, and —
 * when the server named fields — a short list of "Field — problem". Hidden
 * while there is nothing to say. Pair with useForm().
 */
import type { UseForm } from '../composables/useForm';

defineProps<{ form: UseForm }>();
</script>

<template>
  <v-expand-transition>
    <v-alert
      v-if="form.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      role="alert"
      closable
      @click:close="form.reset()"
    >
      <div class="font-weight-medium">{{ form.error.value }}</div>
      <ul v-if="form.lines.value.length" class="form-error__list">
        <li v-for="(line, i) in form.lines.value" :key="i">{{ line }}</li>
      </ul>
    </v-alert>
  </v-expand-transition>
</template>

<style scoped>
.form-error__list { margin: 4px 0 0; padding-inline-start: 18px; font-size: 0.85rem; }
</style>
