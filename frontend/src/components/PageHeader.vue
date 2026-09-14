<script setup lang="ts">
/**
 * The top of every page: a title, one line that says what the page is for,
 * and the page's actions on the same row. One component, so every screen
 * opens the same way and the eye knows where to look.
 */
defineProps<{
  title: string;
  subtitle?: string;
  /** Route to go back to (shows a back arrow before the title). */
  back?: string;
}>();
</script>

<template>
  <header class="page-head">
    <v-btn
      v-if="back"
      icon="arrow-left"
      variant="text"
      size="small"
      :to="back"
      class="page-head__back flip-rtl"
      :aria-label="$t('common.back')"
    />
    <div class="page-head__text">
      <h1 class="page-head__title">
        <slot name="title">{{ title }}</slot>
      </h1>
      <p v-if="subtitle || $slots.subtitle" class="page-head__subtitle">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="page-head__actions">
      <slot />
    </div>
  </header>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  gap: 12px 16px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
[dir='rtl'] .page-head__title { letter-spacing: 0; }
.page-head__back { margin-top: 2px; }
.page-head__text { flex: 1 1 260px; min-width: 0; }
.page-head__title {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.025em;
  margin: 0;
  text-wrap: balance;
}
.page-head__subtitle {
  margin: 6px 0 0;
  font-size: 0.9375rem;
  line-height: 1.55;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  max-width: 64ch;
}
.page-head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[dir='rtl'] .flip-rtl { transform: scaleX(-1); }
</style>
