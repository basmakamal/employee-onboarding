<script setup lang="ts">
/**
 * The one confirmation dialog. Mounted once in App.vue; opened from anywhere
 * through `useConfirm()`, which resolves true/false so call sites read like
 * `if (await confirm({...})) doIt()`. Replaces the browser's window.confirm.
 */
import { useConfirmState } from '../composables/useConfirm';

const state = useConfirmState();
</script>

<template>
  <v-dialog :model-value="state.open" max-width="440" persistent @update:model-value="state.resolve(false)">
    <v-card class="confirm-card">
      <div class="d-flex align-start ga-3 px-6 pt-6 pb-2">
        <v-avatar :color="state.options.color" variant="tonal" size="42" rounded="lg">
          <v-icon :icon="state.options.icon" size="20" />
        </v-avatar>
        <div class="min-w-0">
          <h2 class="text-subtitle-1 font-weight-bold">{{ state.options.title }}</h2>
          <p v-if="state.options.message" class="text-body-2 text-medium-emphasis mb-0 mt-1">
            {{ state.options.message }}
          </p>
        </div>
      </div>
      <v-card-actions class="px-6 pb-5 pt-3">
        <v-spacer />
        <v-btn variant="text" @click="state.resolve(false)">{{ state.options.cancelText }}</v-btn>
        <v-btn variant="flat" :color="state.options.color" class="px-5" :loading="state.busy" @click="state.resolve(true)">
          {{ state.options.confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.confirm-card {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
