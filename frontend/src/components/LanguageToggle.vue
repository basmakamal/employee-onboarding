<script setup lang="ts">
/**
 * Two-option language pill (العربية | English). Both names are always
 * shown in their own script, so a user who cannot read the current
 * language still recognises their own.
 */
import { usePreferencesStore } from '../stores/preferences';

const prefs = usePreferencesStore();
const OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'en', label: 'English' },
] as const;
</script>

<template>
  <div class="lang-toggle" role="group" :aria-label="$t('actions.language')">
    <button
      v-for="opt in OPTIONS"
      :key="opt.value"
      type="button"
      class="lang-toggle__btn"
      :aria-pressed="prefs.locale === opt.value"
      :lang="opt.value"
      @click="prefs.locale = opt.value"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.lang-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}
.lang-toggle__btn {
  border: 0;
  background: transparent;
  padding: 5px 12px;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  transition:
    background-color 200ms cubic-bezier(0.2, 0.7, 0.2, 1),
    color 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.lang-toggle__btn:hover {
  color: rgb(var(--v-theme-on-surface));
}
.lang-toggle__btn[aria-pressed='true'] {
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}
.lang-toggle__btn:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
