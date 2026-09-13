<script setup lang="ts">
/**
 * Nothing to show, said plainly: what is empty and, when it helps, what to
 * do about it. No illustration; a small icon at most.
 */
defineProps<{
  title: string;
  hint?: string;
  icon?: string;
  /** Tighter padding for use inside a table body or a small panel. */
  compact?: boolean;
}>();
</script>

<template>
  <div class="empty" :class="{ 'empty--compact': compact }">
    <v-icon v-if="icon" :icon="icon" size="22" class="empty__icon" />
    <div class="empty__title">{{ title }}</div>
    <div v-if="hint" class="empty__hint">{{ hint }}</div>
    <div v-if="$slots.default" class="empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
  padding: 44px 24px;
}
.empty--compact { padding: 24px 16px; }
.empty__icon { color: rgba(var(--v-theme-on-surface), 0.4); margin-bottom: 6px; }
.empty__title { font-size: 0.9375rem; font-weight: 600; }
.empty__hint {
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  max-width: 44ch;
  line-height: 1.55;
}
.empty__actions { margin-top: 12px; display: flex; gap: 8px; }
</style>
