<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';

interface ExitContext {
  purpose: string;
  employee: { firstName: string; lastName: string };
  completed: boolean;
}

const QUESTIONS = ['leavingReason', 'experience', 'improvements'] as const;

const route = useRoute();
const { t } = useI18n();
const prefs = usePreferencesStore();
const token = route.params['token'] as string;

const state = ref<'loading' | 'ready' | 'submitting' | 'done' | 'invalid'>('loading');
const ctx = ref<ExitContext | null>(null);
const error = ref('');
const answers = ref<Record<string, string>>({ leavingReason: '', experience: '', improvements: '' });

onMounted(async () => {
  try {
    const data = await api.get<ExitContext>(`/api/link/${token}`);
    if (data.purpose !== 'EXIT_INTERVIEW') throw new Error();
    if (data.completed) {
      state.value = 'done';
      return;
    }
    ctx.value = data;
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

async function submit() {
  state.value = 'submitting';
  error.value = '';
  try {
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers.value)) if (v.trim()) filled[k] = v.trim();
    await api.post(`/api/link/${token}/exit-interview`, filled);
    state.value = 'done';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
    state.value = 'ready';
  }
}
</script>

<template>
  <v-container class="py-10" style="max-width: 680px">
    <div class="d-flex justify-end mb-2">
      <v-btn variant="text" size="small" prepend-icon="mdi-translate" @click="prefs.toggleLocale()">
        {{ $t('actions.language') }}
      </v-btn>
    </div>

    <v-card v-if="state === 'loading'" class="pa-12 text-center">
      <v-progress-circular indeterminate color="primary" />
    </v-card>

    <v-card v-else-if="state === 'invalid'" class="pa-10 text-center">
      <v-icon icon="mdi-link-off" size="56" color="error" class="mb-4" />
      <h2 class="text-h6 mb-2">{{ $t('publicForm.invalidTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.invalidHint') }}</p>
    </v-card>

    <v-card v-else-if="state === 'done'" class="pa-10 text-center">
      <v-icon icon="mdi-heart" size="64" color="primary" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('exitInterview.doneTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('exitInterview.doneHint') }}</p>
    </v-card>

    <v-card v-else-if="ctx" class="pa-2">
      <v-card-item>
        <v-card-title class="text-h5 font-weight-bold">
          {{ $t('exitInterview.title') }}
        </v-card-title>
        <v-card-subtitle>
          {{ $t('publicForm.greeting', { name: `${ctx.employee.firstName} ${ctx.employee.lastName}` }) }}
        </v-card-subtitle>
      </v-card-item>

      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
        <p class="text-medium-emphasis mb-4">{{ $t('exitInterview.intro') }}</p>

        <v-textarea
          v-for="q in QUESTIONS"
          :key="q"
          v-model="answers[q]"
          :label="$t(`exitInterview.${q}`)"
          rows="3"
          class="mb-2"
        />
      </v-card-text>

      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn
          color="primary"
          size="large"
          variant="flat"
          :loading="state === 'submitting'"
          :disabled="!answers['leavingReason']?.trim()"
          @click="submit"
        >
          {{ $t('common.submit') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<style scoped>
.pop {
  animation: pop 0.4s ease;
}
@keyframes pop {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
