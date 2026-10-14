<script setup lang="ts">
/**
 * "Ready to work and be paid?" — the checklist attendance and payroll will
 * rely on. Required items must all hold; the rest are advice; items of
 * modules still being built are shown but do not count yet.
 */
import { onMounted, ref, watch } from 'vue';
import { api } from '../api/client';

interface Item { key: string; ok: boolean; required: boolean; soon?: boolean }

const props = defineProps<{ employeeId: string; refreshKey?: number }>();
const data = ref<{ ready: boolean; items: Item[] } | null>(null);

async function load() {
  try {
    data.value = await api.get(`/api/employees/${props.employeeId}/readiness`);
  } catch {
    data.value = null;
  }
}
onMounted(load);
watch(() => props.refreshKey, load);

const icon = (i: Item) => (i.soon ? 'clock' : i.ok ? 'circle-check' : i.required ? 'circle-x' : 'circle-alert');
const color = (i: Item) => (i.soon ? 'grey' : i.ok ? 'success' : i.required ? 'error' : 'warning');
</script>

<template>
  <v-card v-if="data" class="mb-4">
    <v-card-item>
      <v-card-title class="text-subtitle-1 font-weight-bold d-flex align-center ga-2">
        <v-icon icon="fluent:checkmark-circle" />
        {{ $t('readiness.title') }}
        <v-spacer />
        <v-chip size="small" variant="tonal" :color="data.ready ? 'success' : 'warning'">
          {{ data.ready ? $t('readiness.ready') : $t('readiness.notReady') }}
        </v-chip>
      </v-card-title>
    </v-card-item>
    <v-card-text class="pt-0">
      <p class="text-caption text-medium-emphasis mb-2">{{ $t('readiness.hint') }}</p>
      <div v-for="i in data.items" :key="i.key" class="d-flex align-center ga-2 py-1" :class="{ 'text-medium-emphasis': i.soon }">
        <v-icon :icon="icon(i)" :color="color(i)" size="18" />
        <span class="text-body-2 flex-grow-1">{{ $t(`readiness.items.${i.key}`) }}</span>
        <span v-if="i.soon" class="text-caption">{{ $t('readiness.soon') }}</span>
        <span v-else-if="!i.required" class="text-caption text-medium-emphasis">{{ $t('readiness.optional') }}</span>
      </div>
    </v-card-text>
  </v-card>
</template>
