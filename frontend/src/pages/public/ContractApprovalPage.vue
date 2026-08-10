<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';

interface ApprovalContext {
  purpose: string;
  employee: { firstName: string; lastName: string };
  contract: { details: Record<string, unknown> | null; sentAt: string | null } | null;
}

const route = useRoute();
const { t } = useI18n();
const prefs = usePreferencesStore();
const token = route.params['token'] as string;

const state = ref<'loading' | 'ready' | 'approving' | 'done' | 'invalid'>('loading');
const ctx = ref<ApprovalContext | null>(null);
const employeeNo = ref('');
const error = ref('');

onMounted(async () => {
  try {
    const data = await api.get<ApprovalContext>(`/api/link/${token}`);
    if (data.purpose !== 'CONTRACT_APPROVAL' || !data.contract) throw new Error();
    ctx.value = data;
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

async function approve() {
  state.value = 'approving';
  error.value = '';
  try {
    const result = await api.post<{ employeeNo: string }>(`/api/link/${token}/approve-contract`);
    employeeNo.value = result.employeeNo;
    state.value = 'done';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
    state.value = 'ready';
  }
}
</script>

<template>
  <v-container class="py-10" style="max-width: 640px">
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
      <v-icon icon="mdi-check-decagram" size="64" color="success" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('approval.doneTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('approval.doneHint', { no: employeeNo }) }}</p>
    </v-card>

    <v-card v-else-if="ctx" class="pa-2">
      <v-card-item>
        <v-card-title class="text-h5 font-weight-bold">{{ $t('approval.title') }}</v-card-title>
        <v-card-subtitle>
          {{ $t('publicForm.greeting', { name: `${ctx.employee.firstName} ${ctx.employee.lastName}` }) }}
        </v-card-subtitle>
      </v-card-item>

      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

        <v-table density="comfortable">
          <tbody>
            <tr v-for="(v, k) in ctx.contract?.details ?? {}" :key="k">
              <td class="font-weight-medium" style="width: 40%">{{ $t(`contract.${k}`, String(k)) }}</td>
              <td>{{ v }}</td>
            </tr>
          </tbody>
        </v-table>
        <p class="text-caption text-medium-emphasis mt-4">{{ $t('approval.hint') }}</p>
      </v-card-text>

      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn
          color="success"
          size="large"
          variant="flat"
          prepend-icon="mdi-check-decagram"
          :loading="state === 'approving'"
          @click="approve"
        >
          {{ $t('approval.approveBtn') }}
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
