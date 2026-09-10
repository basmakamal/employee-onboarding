<script setup lang="ts">
/**
 * The phone-sized row for any list: avatar, name, one line of context, a
 * status chip, and a single action. Tables render this under 700 px instead
 * of scrolling sideways.
 */
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    meta?: string;
    initials?: string;
    to?: string;
    chip?: { text: string; color?: string } | null;
    actionText?: string;
  }>(),
  { chip: null },
);
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <component :is="to ? 'router-link' : 'div'" :to="to" class="entity-card">
    <div class="entity-card__row">
      <v-avatar v-if="initials" size="36" color="secondary" variant="tonal">
        <span class="text-caption font-weight-bold">{{ initials }}</span>
      </v-avatar>
      <div class="min-w-0 flex-grow-1">
        <div class="text-body-2 font-weight-semibold text-truncate">{{ title }}</div>
        <div v-if="subtitle" class="text-caption text-medium-emphasis text-truncate">{{ subtitle }}</div>
      </div>
      <v-chip v-if="chip" size="x-small" :color="chip.color ?? 'primary'" class="status-dot">{{ chip.text }}</v-chip>
    </div>
    <div v-if="meta || actionText" class="entity-card__foot">
      <span class="text-caption text-medium-emphasis text-truncate">{{ meta }}</span>
      <v-btn v-if="actionText" size="small" variant="tonal" color="primary" @click.prevent.stop="emit('action')">
        {{ actionText }}
      </v-btn>
    </div>
  </component>
</template>

<style scoped>
.entity-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  color: inherit;
  text-decoration: none;
  transition: background 160ms var(--app-ease), transform 160ms var(--app-ease);
}
.entity-card:active { transform: scale(0.99); }
.entity-card__row { display: flex; align-items: center; gap: 12px; }
.entity-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
</style>
