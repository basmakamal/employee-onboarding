<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api/client';

interface BellItem {
  id: string;
  subject: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const items = ref<BellItem[]>([]);
const unread = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    const data = await api.get<{ items: BellItem[]; unread: number }>('/api/notifications');
    items.value = data.items;
    unread.value = data.unread;
  } catch {
    /* transient — the next poll retries */
  }
}

async function onOpen(open: boolean) {
  if (!open || unread.value === 0) return;
  await api.post('/api/notifications/read-all').catch(() => null);
  unread.value = 0;
  await load();
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 60_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <v-menu width="380" max-height="480" @update:model-value="onOpen">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon>
        <v-badge :content="unread" :model-value="unread > 0" color="error">
          <v-icon icon="mdi-bell-outline" />
        </v-badge>
      </v-btn>
    </template>
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold">
        {{ $t('bell.title') }}
      </v-card-title>
      <v-divider />
      <v-list v-if="items.length" density="compact" lines="three">
        <v-list-item v-for="item in items" :key="item.id" :class="{ 'unread-item': !item.readAt }">
          <v-list-item-title class="font-weight-medium">{{ item.subject }}</v-list-item-title>
          <v-list-item-subtitle>{{ item.body }}</v-list-item-subtitle>
          <v-list-item-subtitle class="text-caption">
            {{ new Date(item.createdAt).toLocaleString() }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <v-card-text v-else class="text-medium-emphasis text-center py-8">
        {{ $t('bell.empty') }}
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.unread-item {
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
