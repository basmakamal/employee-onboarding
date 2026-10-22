<script setup lang="ts">
/**
 * The contract page behind a CONTRACT_APPROVAL signed link.
 *
 * The new hire reads the terms HR recorded, downloads the contract document
 * (served through the same token rather than mailed as an attachment), and
 * accepts or rejects it. Accepting runs the same transition HR performs by
 * hand, so an e-approval and an HR approval leave the record identical.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/client';
import { usePreferencesStore } from '../../stores/preferences';

interface ContractContext {
  purpose: string;
  employee: {
    firstName: string;
    lastName: string;
    department: string | null;
    jobTitle: string | null;
    status: string;
    preferredLanguage?: 'AR' | 'EN';
  };
  contract: {
    status: string;
    externalRef: string | null;
    salary: string | number | null;
    durationMonths: string | number | null;
    startDate: string | null;
    terms: string | null;
    hasDocument: boolean;
  };
}

const route = useRoute();
const { t } = useI18n();
const prefs = usePreferencesStore();
const token = route.params['token'] as string;

const state = ref<'loading' | 'ready' | 'deciding' | 'accepted' | 'rejected' | 'invalid'>('loading');
const ctx = ref<ContractContext | null>(null);
const error = ref('');
const employeeNo = ref<string | null>(null);
const acceptDialog = ref(false);
const rejectDialog = ref(false);
const rejectReason = ref('');

onMounted(async () => {
  try {
    const data = await api.get<ContractContext>(`/api/link/${token}`);
    if (data.purpose !== 'CONTRACT_APPROVAL') throw new Error();
    ctx.value = data;
    if (data.employee.preferredLanguage) {
      prefs.locale = data.employee.preferredLanguage === 'EN' ? 'en' : 'ar';
    }
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

const fullName = computed(() =>
  ctx.value ? `${ctx.value.employee.firstName} ${ctx.value.employee.lastName}`.trim() : '',
);

/** Start + duration, minus a day — the same arithmetic the email uses. */
const endDate = computed(() => {
  const c = ctx.value?.contract;
  if (!c?.startDate || !c.durationMonths) return null;
  const months = Number(c.durationMonths);
  const start = new Date(`${String(c.startDate).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(months) || Number.isNaN(start.getTime())) return null;
  start.setUTCMonth(start.getUTCMonth() + months);
  start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
});

const rows = computed(() => {
  const c = ctx.value?.contract;
  if (!c) return [];
  return [
    { label: 'contractCard.salary', value: c.salary != null ? String(c.salary) : null },
    {
      label: 'contractCard.duration',
      value: c.durationMonths != null ? String(c.durationMonths) : null,
      months: true,
    },
    { label: 'contractCard.start', value: c.startDate ? String(c.startDate).slice(0, 10) : null },
    { label: 'contractCard.end', value: endDate.value },
    { label: 'contract.externalRef', value: c.externalRef },
    { label: 'fields.jobTitle', value: ctx.value?.employee.jobTitle ?? null },
    { label: 'fields.department', value: ctx.value?.employee.department ?? null },
  ].filter((r) => r.value);
});

/** Only a contract actually waiting on this person can be decided. */
const canDecide = computed(() => ctx.value?.employee.status === 'AWAITING_CONTRACT_APPROVAL');

/** The document is behind the token, so it opens as a normal link. */
const documentUrl = computed(() => `/api/link/${token}/contract/file`);

async function decide(decision: 'APPROVE' | 'REJECT') {
  acceptDialog.value = false;
  rejectDialog.value = false;
  state.value = 'deciding';
  error.value = '';
  try {
    const res = await api.post<{ decision: string; employeeNo: string | null }>(
      `/api/link/${token}/contract/decision`,
      {
        decision,
        ...(decision === 'REJECT' && rejectReason.value.trim()
          ? { rejectReason: rejectReason.value.trim() }
          : {}),
      },
    );
    employeeNo.value = res.employeeNo;
    state.value = decision === 'APPROVE' ? 'accepted' : 'rejected';
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
    state.value = 'ready';
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 720px">
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
      <h2 class="text-h6 mb-2">{{ $t('contractPage.invalidTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('contractPage.invalidHint') }}</p>
    </v-card>

    <v-card v-else-if="state === 'accepted'" class="pa-10 text-center">
      <v-icon icon="circle-check" size="64" color="success" class="mb-4 pop" />
      <h2 class="text-h5 mb-2">{{ $t('contractPage.acceptedTitle') }}</h2>
      <p class="text-medium-emphasis mb-1">{{ $t('contractPage.acceptedHint') }}</p>
      <p v-if="employeeNo" class="text-body-2 font-weight-medium">
        {{ $t('contractPage.employeeNo', { no: employeeNo }) }}
      </p>
    </v-card>

    <v-card v-else-if="state === 'rejected'" class="pa-10 text-center">
      <v-icon icon="send" size="56" color="warning" class="mb-4 pop" />
      <h2 class="text-h6 mb-2">{{ $t('contractPage.rejectedTitle') }}</h2>
      <p class="text-medium-emphasis">{{ $t('contractPage.rejectedHint') }}</p>
    </v-card>

    <v-card v-else-if="ctx">
      <div class="form-head">
        <img src="/riyada-logo.png" alt="Riyada HR" class="form-logo" />
        <div>
          <h1 class="form-title">{{ $t('contractPage.title') }}</h1>
          <p class="form-subtitle">{{ $t('contractPage.greeting', { name: fullName }) }}</p>
        </div>
      </div>
      <div class="brand-rule"><span></span><i></i></div>

      <v-card-text class="pt-5 px-5 px-sm-7">
        <p class="text-body-2 mb-5">{{ $t('contractPage.intro') }}</p>

        <v-alert v-if="error" type="error" variant="tonal" class="mb-5 text-body-2">{{ error }}</v-alert>

        <h3 class="sec">{{ $t('contractPage.terms') }}</h3>
        <v-table density="comfortable" class="terms">
          <tbody>
            <tr v-for="row in rows" :key="row.label">
              <th class="text-medium-emphasis">{{ $t(row.label) }}</th>
              <td class="font-weight-medium">
                {{ row.months ? $t('contractCard.months', { n: row.value }) : row.value }}
              </td>
            </tr>
          </tbody>
        </v-table>

        <template v-if="ctx.contract.terms">
          <h3 class="sec">{{ $t('contractPage.additionalTerms') }}</h3>
          <p class="text-body-2" style="white-space: pre-wrap">{{ ctx.contract.terms }}</p>
        </template>

        <h3 class="sec">{{ $t('contractPage.document') }}</h3>
        <template v-if="ctx.contract.hasDocument">
          <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('contractPage.documentHint') }}</p>
          <v-btn
            :href="documentUrl"
            target="_blank"
            rel="noopener"
            color="primary"
            variant="tonal"
            prepend-icon="file-signature"
          >
            {{ $t('contractPage.open') }}
          </v-btn>
        </template>
        <v-alert v-else type="info" variant="tonal" density="comfortable">
          {{ $t('contractPage.noDocument') }}
        </v-alert>

        <template v-if="canDecide">
          <h3 class="sec">{{ $t('contractPage.decide') }}</h3>
          <p class="text-body-2 text-medium-emphasis mb-4">{{ $t('contractPage.statusNote') }}</p>
          <div class="d-flex flex-wrap ga-3">
            <v-btn
              color="success"
              size="large"
              variant="flat"
              class="px-6"
              prepend-icon="badge-check"
              :loading="state === 'deciding'"
              @click="acceptDialog = true"
            >
              {{ $t('contractPage.accept') }}
            </v-btn>
            <v-btn
              color="error"
              size="large"
              variant="outlined"
              prepend-icon="octagon-x"
              :disabled="state === 'deciding'"
              @click="rejectDialog = true"
            >
              {{ $t('contractPage.reject') }}
            </v-btn>
          </div>
        </template>
        <v-alert v-else type="info" variant="tonal" density="comfortable" class="mt-6 text-body-2">
          {{ $t('contractPage.closed') }}
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- Accepting is a signature: it gets its own confirmation. -->
    <v-dialog v-model="acceptDialog" max-width="440">
      <v-card :title="$t('contractPage.acceptConfirmTitle')">
        <v-card-text class="text-body-2">{{ $t('contractPage.acceptConfirm') }}</v-card-text>
        <v-card-actions class="px-5 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="acceptDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="success" variant="flat" class="px-5" @click="decide('APPROVE')">
            {{ $t('contractPage.accept') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="rejectDialog" max-width="480">
      <v-card :title="$t('contractPage.rejectTitle')">
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-4">{{ $t('contractPage.rejectHint') }}</p>
          <v-textarea v-model="rejectReason" :label="$t('contractPage.rejectReason')" rows="3" autofocus />
        </v-card-text>
        <v-card-actions class="px-5 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" class="px-5" @click="decide('REJECT')">
            {{ $t('contractPage.reject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.form-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px 14px;
  flex-wrap: wrap;
}
.form-logo {
  height: 40px;
  width: auto;
}
.form-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.3;
}
.form-subtitle {
  margin: 2px 0 0;
  font-size: 0.82rem;
  opacity: 0.7;
}
.brand-rule {
  display: flex;
  height: 3px;
}
.brand-rule span {
  flex: 65;
  background: #35708f;
}
.brand-rule i {
  flex: 35;
  background: #4e9e8f;
}
.sec {
  font-size: 1rem;
  font-weight: 700;
  margin: 26px 0 12px;
  padding-inline-start: 10px;
  border-inline-start: 3px solid #35708f;
  line-height: 1.4;
}
.sec:first-of-type {
  margin-top: 6px;
}
.terms :deep(th) {
  width: 42%;
  font-weight: 500;
}
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
@media (prefers-reduced-motion: reduce) {
  .pop {
    animation: none;
  }
}
</style>
