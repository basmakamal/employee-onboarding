<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText } from '../../validation/errors';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';
import { rules } from '../../validation/rules';

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
/** Only the first question is required; the field rule marks it when Submit is pressed. */
const formRef = ref<{ validate(): Promise<{ valid: boolean }> } | null>(null);

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
  if (state.value === 'submitting') return;
  error.value = '';
  const { valid } = (await formRef.value?.validate()) ?? { valid: true };
  if (!valid) {
    error.value = t('errors.fixFields');
    return;
  }
  state.value = 'submitting';
  try {
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers.value)) if (v.trim()) filled[k] = v.trim();
    await api.post(`/api/link/${token}/exit-interview`, filled);
    state.value = 'done';
  } catch (e) {
    error.value = errorText(e);
    state.value = 'ready';
  }
}
</script>

<template>
  <v-container class="py-10" style="max-width: 680px">
    <div class="d-flex justify-end mb-2">
      <v-btn variant="text" size="small" prepend-icon="languages" @click="prefs.toggleLocale()">
        {{ $t('actions.language') }}
      </v-btn>
    </div>

    <v-card v-if="state === 'loading'" class="pa-12 text-center">
      <v-progress-circular indeterminate color="primary" />
    </v-card>

    <v-card v-else-if="state === 'invalid'" class="pa-10 text-center">
      <v-icon icon="unlink" size="56" color="error" class="mb-4" />
      <h2 class="text-h6 mb-2">{{ $t('publicForm.invalidTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.invalidHint') }}</p>
    </v-card>

    <v-card v-else-if="state === 'done'" class="pa-10 text-center">
      <v-icon icon="heart" size="64" color="primary" class="mb-4 pop" />
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

        <v-form ref="formRef" @submit.prevent="submit">
          <v-textarea
            v-for="q in QUESTIONS"
            :key="q"
            v-model="answers[q]"
            :label="$t(`exitInterview.${q}`) + (q === 'leavingReason' ? ' *' : '')"
            :rules="q === 'leavingReason' ? [rules.required, rules.maxLength(4000)] : [rules.maxLength(4000)]"
            rows="3"
            class="mb-2"
          />
        </v-form>
      </v-card-text>

      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn
          color="primary"
          size="large"
          variant="flat"
          :loading="state === 'submitting'"
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
