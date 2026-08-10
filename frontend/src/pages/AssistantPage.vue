<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const { t } = useI18n();
const turns = ref<ChatTurn[]>([]);
const input = ref('');
const busy = ref(false);
const error = ref('');
const scroller = ref<HTMLElement | null>(null);

async function send() {
  const question = input.value.trim();
  if (!question || busy.value) return;
  error.value = '';
  turns.value.push({ role: 'user', content: question });
  input.value = '';
  busy.value = true;
  await scrollDown();
  try {
    const { reply } = await api.post<{ reply: string }>('/api/ai/chat', {
      messages: turns.value,
    });
    turns.value.push({ role: 'assistant', content: reply });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
    turns.value.pop(); // let the user retry the same question
    input.value = question;
  } finally {
    busy.value = false;
    await scrollDown();
  }
}

async function scrollDown() {
  await nextTick();
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' });
}
</script>

<template>
  <v-container class="py-8 d-flex flex-column" style="max-width: 860px; height: calc(100vh - 64px)">
    <div class="mb-4">
      <h1 class="text-h4 font-weight-bold">
        <v-icon icon="mdi-robot-happy-outline" color="primary" class="me-2" />
        {{ $t('ai.assistantTitle') }}
      </h1>
      <p class="text-medium-emphasis mt-1">{{ $t('ai.assistantSubtitle') }}</p>
    </div>

    <v-card class="flex-grow-1 d-flex flex-column" style="min-height: 0">
      <div ref="scroller" class="flex-grow-1 overflow-y-auto pa-4">
        <p v-if="turns.length === 0" class="text-medium-emphasis text-center mt-8">
          {{ $t('ai.emptyChat') }}
        </p>
        <div
          v-for="(turn, i) in turns"
          :key="i"
          class="d-flex mb-3"
          :class="turn.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <v-sheet
            :color="turn.role === 'user' ? 'primary' : undefined"
            :class="turn.role === 'user' ? '' : 'bubble-assistant'"
            class="pa-3 rounded-lg text-body-2"
            style="max-width: 80%; white-space: pre-wrap"
          >
            {{ turn.content }}
          </v-sheet>
        </div>
        <div v-if="busy" class="d-flex justify-start mb-3">
          <v-sheet class="pa-3 rounded-lg bubble-assistant">
            <v-progress-circular indeterminate size="18" width="2" class="me-2" />
            <span class="text-body-2 text-medium-emphasis">{{ $t('ai.generating') }}</span>
          </v-sheet>
        </div>
      </div>

      <v-divider />
      <div class="pa-3">
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-2">
          {{ error }}
        </v-alert>
        <v-text-field
          v-model="input"
          :placeholder="$t('ai.askPlaceholder')"
          density="comfortable"
          hide-details
          :disabled="busy"
          append-inner-icon="mdi-send"
          @keydown.enter="send"
          @click:append-inner="send"
        />
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.bubble-assistant {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
[dir='rtl'] .v-icon--icon-mdi-send {
  transform: scaleX(-1);
}
</style>
