<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api, getAccessToken } from '../api/client';

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
let streamAbort: AbortController | null = null;
let stopped = false;

async function load() {
  try {
    const data = await api.get<{ items: BellItem[]; unread: number }>('/api/notifications');
    items.value = data.items;
    unread.value = data.unread;
  } catch {
    /* transient — the next poll or nudge retries */
  }
}

/**
 * Live channel: the server pushes "notify" over SSE the moment a new
 * in-app notification lands, and we refetch. EventSource can't carry the
 * Authorization header, so this reads the stream via fetch. Any drop
 * reconnects after a short pause — and the slow poll below covers the gaps.
 */
async function listen() {
  while (!stopped) {
    streamAbort = new AbortController();
    try {
      const res = await fetch('/api/events', {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        credentials: 'include',
        signal: streamAbort.signal,
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (decoder.decode(value).includes('event: notify')) void load();
      }
    } catch {
      /* dropped — fall through to the retry pause */
    }
    if (!stopped) await new Promise((r) => setTimeout(r, 5_000));
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
  void listen();
  // Safety-net poll: 5 minutes, and only while the tab is visible — SSE
  // carries the real-time load now.
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, 300_000);
});
onUnmounted(() => {
  stopped = true;
  streamAbort?.abort();
  clearInterval(timer);
});
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
