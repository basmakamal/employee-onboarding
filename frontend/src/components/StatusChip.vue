<script setup lang="ts">
/**
 * An employee's status as a coloured dot and a word. Colour carries the
 * meaning, the dot keeps it readable without colour, and there is no tinted
 * pill fighting the row for attention. `variant="chip"` keeps the older
 * pill for the few places that sit on a dark or busy background.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useListsStore } from '../stores/lists';

const props = withDefaults(defineProps<{ status: string; variant?: 'dot' | 'chip' }>(), { variant: 'dot' });
const { t } = useI18n();
const lists = useListsStore();

/** Semantic tone per status: green when working, amber when waiting on someone, grey when over. */
const TONE: Record<string, 'success' | 'warning' | 'info' | 'error' | 'neutral'> = {
  CREATED: 'neutral',
  AWAITING_FORM: 'warning',
  FORM_RECEIVED: 'info',
  CONTRACT_CREATION: 'info',
  AWAITING_CONTRACT_APPROVAL: 'warning',
  EXPIRED: 'error',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  WITHDRAWN: 'neutral',
};

const tone = computed(() => TONE[props.status] ?? 'neutral');
/** The admin's label for this status in the current language, else the built-in one. */
const label = computed(() => lists.label('EMPLOYEE_STATUS', props.status) ?? t(`status.${props.status}`));
</script>

<template>
  <v-chip v-if="variant === 'chip'" :color="tone === 'neutral' ? undefined : tone" size="small" variant="tonal" class="status-dot font-weight-medium">
    {{ label }}
  </v-chip>
  <span v-else class="status" :class="`status--${tone}`">
    <span class="status__dot" aria-hidden="true" />{{ label }}
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}
.status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.35);
  flex: none;
}
.status--success .status__dot { background: rgb(var(--v-theme-success)); }
.status--warning .status__dot { background: rgb(var(--v-theme-warning)); }
.status--info .status__dot { background: rgb(var(--v-theme-info)); }
.status--error .status__dot { background: rgb(var(--v-theme-error)); }
.status--neutral { color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
</style>
