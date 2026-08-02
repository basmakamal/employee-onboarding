<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';

interface AssetItem {
  type: string;
  name: string;
  serialNumber: string | null;
  quantity: number;
  condition: 'NEW' | 'USED';
  notes: string | null;
}

interface AssetContext {
  purpose: string;
  employee: { firstName: string; lastName: string; employeeNo: string; department: string | null; jobTitle: string | null };
  form: { status: string; deliveryDate: string | null; items: AssetItem[] };
}

const route = useRoute();
const { t } = useI18n();
const prefs = usePreferencesStore();
const token = route.params['token'] as string;

const state = ref<'loading' | 'ready' | 'deciding' | 'approved' | 'rejected' | 'invalid'>('loading');
const ctx = ref<AssetContext | null>(null);
const error = ref('');
const rejectDialog = ref(false);
const rejectReason = ref('');

onMounted(async () => {
  try {
    const data = await api.get<AssetContext>(`/api/link/${token}`);
    if (data.purpose !== 'ASSET_APPROVAL') throw new Error();
    ctx.value = data;
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

async function decide(decision: 'APPROVE' | 'REJECT') {
  state.value = 'deciding';
  error.value = '';
  try {
    await api.post(`/api/link/${token}/assets/decision`, {
      decision,
      rejectReason: decision === 'REJECT' ? rejectReason.value || undefined : undefined,
    });
    state.value = decision === 'APPROVE' ? 'approved' : 'rejected';
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

    <v-card v-else-if="state === 'approved'" class="pa-10 text-center">
      <v-icon icon="mdi-check-decagram" size="64" color="success" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('assetApproval.approvedTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('assetApproval.approvedHint') }}</p>
    </v-card>

    <v-card v-else-if="state === 'rejected'" class="pa-10 text-center">
      <v-icon icon="mdi-close-circle" size="64" color="warning" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('assetApproval.rejectedTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('assetApproval.rejectedHint') }}</p>
    </v-card>

    <v-card v-else-if="ctx" class="pa-2">
      <v-card-item>
        <v-card-title class="text-h5 font-weight-bold">{{ $t('assetApproval.title') }}</v-card-title>
        <v-card-subtitle>
          {{ $t('publicForm.greeting', { name: `${ctx.employee.firstName} ${ctx.employee.lastName}` }) }}
          · {{ ctx.employee.employeeNo }}
        </v-card-subtitle>
      </v-card-item>

      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('assets.type') }}</th>
              <th>{{ $t('assets.name') }}</th>
              <th>{{ $t('assets.serial') }}</th>
              <th>{{ $t('assets.qty') }}</th>
              <th>{{ $t('assets.condition') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in ctx.form.items" :key="i">
              <td>{{ item.type }}</td>
              <td>{{ item.name }}</td>
              <td>{{ item.serialNumber ?? '—' }}</td>
              <td>{{ item.quantity }}</td>
              <td>{{ $t(`conditions.${item.condition}`) }}</td>
            </tr>
          </tbody>
        </v-table>
        <p class="text-caption text-medium-emphasis mt-4">{{ $t('assetApproval.hint') }}</p>
      </v-card-text>

      <v-card-actions class="pa-4">
        <v-btn color="warning" variant="tonal" :loading="state === 'deciding'" @click="rejectDialog = true">
          {{ $t('assetApproval.rejectBtn') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="success"
          size="large"
          variant="flat"
          prepend-icon="mdi-check-decagram"
          :loading="state === 'deciding'"
          @click="decide('APPROVE')"
        >
          {{ $t('assetApproval.approveBtn') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="rejectDialog" max-width="440">
      <v-card :title="$t('assetApproval.rejectBtn')" class="pa-2">
        <v-card-text>
          <v-textarea v-model="rejectReason" :label="$t('assets.rejectReason')" rows="3" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="warning" @click="rejectDialog = false; decide('REJECT')">
            {{ $t('common.send') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
