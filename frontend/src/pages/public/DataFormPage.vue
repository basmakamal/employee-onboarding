<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';

interface FormDoc {
  id: string;
  type: string;
  label: string | null;
  required: boolean;
  uploaded: boolean;
}

interface FormContext {
  purpose: string;
  employee: { firstName: string; lastName: string; phone: string | null; nationalId: string | null; birthDate: string | null };
  documents: FormDoc[];
}

const route = useRoute();
const { t } = useI18n();
const prefs = usePreferencesStore();
const token = route.params['token'] as string;

const state = ref<'loading' | 'ready' | 'submitting' | 'done' | 'invalid'>('loading');
const ctx = ref<FormContext | null>(null);
const error = ref('');
const fields = ref({ phone: '', nationalId: '', birthDate: '' });
const files = ref<Record<string, File | null>>({});

onMounted(async () => {
  try {
    const data = await api.get<FormContext>(`/api/link/${token}`);
    if (data.purpose !== 'DATA_FORM') throw new Error();
    ctx.value = data;
    fields.value = {
      phone: data.employee.phone ?? '',
      nationalId: data.employee.nationalId ?? '',
      birthDate: data.employee.birthDate?.slice(0, 10) ?? '',
    };
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

function onFile(docId: string, fileList: File | File[] | null) {
  files.value[docId] = Array.isArray(fileList) ? (fileList[0] ?? null) : fileList;
}

function missingRequired(): boolean {
  return (ctx.value?.documents ?? []).some((d) => d.required && !d.uploaded && !files.value[d.id]);
}

async function submit() {
  state.value = 'submitting';
  error.value = '';
  const body = new FormData();
  for (const [k, v] of Object.entries(fields.value)) if (v) body.append(k, v);
  for (const [docId, file] of Object.entries(files.value)) if (file) body.append(docId, file);

  try {
    await api.post(`/api/link/${token}/form`, body);
    state.value = 'done';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
    state.value = 'ready';
  }
}
</script>

<template>
  <v-container class="py-10" style="max-width: 720px">
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
      <v-icon icon="mdi-check-circle" size="64" color="success" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('publicForm.doneTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('publicForm.doneHint') }}</p>
    </v-card>

    <template v-else-if="ctx">
      <v-card class="pa-2">
        <v-card-item>
          <v-card-title class="text-h5 font-weight-bold">
            {{ $t('publicForm.title') }}
          </v-card-title>
          <v-card-subtitle>
            {{ $t('publicForm.greeting', { name: `${ctx.employee.firstName} ${ctx.employee.lastName}` }) }}
          </v-card-subtitle>
        </v-card-item>

        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

          <h3 class="text-subtitle-1 font-weight-bold mb-3">{{ $t('publicForm.info') }}</h3>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.phone" :label="$t('fields.phone')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.nationalId" :label="$t('fields.nationalId')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="fields.birthDate" :label="$t('fields.birthDate')" type="date" />
            </v-col>
          </v-row>

          <h3 class="text-subtitle-1 font-weight-bold mt-6 mb-3">{{ $t('onboarding.documents') }}</h3>
          <div v-for="doc in ctx.documents" :key="doc.id" class="mb-3">
            <v-file-input
              v-if="!doc.uploaded"
              :label="(doc.label ?? $t(`docTypes.${doc.type}`, doc.type)) + (doc.required ? ' *' : '')"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              prepend-icon="mdi-paperclip"
              density="comfortable"
              @update:model-value="onFile(doc.id, $event)"
            />
            <v-alert v-else type="success" variant="tonal" density="compact">
              {{ doc.label ?? $t(`docTypes.${doc.type}`, doc.type) }} — {{ $t('onboarding.uploaded') }}
            </v-alert>
          </div>
          <p class="text-caption text-medium-emphasis">{{ $t('publicForm.fileHint') }}</p>
        </v-card-text>

        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn
            color="primary"
            size="large"
            variant="flat"
            :loading="state === 'submitting'"
            :disabled="missingRequired()"
            @click="submit"
          >
            {{ $t('common.submit') }}
          </v-btn>
        </v-card-actions>
      </v-card>
      <p v-if="missingRequired()" class="text-caption text-medium-emphasis text-center mt-3">
        {{ $t('publicForm.requiredHint') }}
      </p>
    </template>
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
