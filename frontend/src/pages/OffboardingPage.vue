<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface AssetItem {
  id: string;
  type: string;
  name: string;
  serialNumber: string | null;
  quantity: number;
  returnedAt: string | null;
}

interface OffboardingDetail {
  id: string;
  employeeId: string;
  reason: string;
  status: string;
  notes: string | null;
  exitInterviewSentAt: string | null;
  exitInterviewCompletedAt: string | null;
  exitInterviewData: Record<string, string> | null;
  assetsConfirmedAt: string | null;
  noticeSentAt: string | null;
  settlementWorkingDays: number | null;
  settlementLeaveDays: string | number | null;
  settlementDeductions: string | number | null;
  settlementEntitlements: string | number | null;
  settlementNotes: string | null;
  closedAt: string | null;
  employee: { firstName: string; lastName: string; employeeNo: string } | null;
  availableActions: string[];
  assets: { items: AssetItem[]; unreturned: number };
}

const STAGES = ['REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT', 'CLOSED'];

const ACTION_META: Record<string, { endpoint: string; icon: string; color: string }> = {
  START: { endpoint: 'start', icon: 'mdi-play', color: 'primary' },
  TO_ASSET_RETURN: { endpoint: 'to-asset-return', icon: 'mdi-laptop', color: 'primary' },
  CONFIRM_ASSETS_RETURNED: { endpoint: 'confirm-assets', icon: 'mdi-check-all', color: 'success' },
  TO_SETTLEMENT: { endpoint: 'to-settlement', icon: 'mdi-cash', color: 'primary' },
  CLOSE: { endpoint: 'close', icon: 'mdi-lock-check', color: 'success' },
  CANCEL: { endpoint: 'cancel', icon: 'mdi-close-circle', color: 'error' },
};

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const id = route.params['id'] as string;

const record = ref<OffboardingDetail | null>(null);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const settlement = ref({ workingDays: '', leaveDays: '', deductions: '', entitlements: '', notes: '' });

const currentStep = computed(() =>
  record.value ? Math.max(0, STAGES.indexOf(record.value.status)) : 0,
);
const settlementEntered = computed(() => record.value?.settlementEntitlements !== null);

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  record.value = await api.get<OffboardingDetail>(`/api/offboardings/${id}`);
  const r = record.value;
  if (r.settlementWorkingDays !== null) {
    settlement.value = {
      workingDays: String(r.settlementWorkingDays ?? ''),
      leaveDays: String(r.settlementLeaveDays ?? ''),
      deductions: String(r.settlementDeductions ?? ''),
      entitlements: String(r.settlementEntitlements ?? ''),
      notes: r.settlementNotes ?? '',
    };
  }
}

async function runAction(action: string) {
  const meta = ACTION_META[action];
  if (!meta) return;
  busy.value = action;
  try {
    await api.post(`/api/offboardings/${id}/actions/${meta.endpoint}`);
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function markReturned(itemId: string) {
  busy.value = itemId;
  try {
    await api.put(`/api/offboardings/${id}/assets/${itemId}/return`);
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function saveSettlement() {
  busy.value = 'settlement';
  try {
    await api.put(`/api/offboardings/${id}/settlement`, {
      workingDays: Number(settlement.value.workingDays),
      leaveDays: Number(settlement.value.leaveDays),
      deductions: Number(settlement.value.deductions || 0),
      entitlements: Number(settlement.value.entitlements),
      notes: settlement.value.notes || undefined,
    });
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <v-container v-if="record" class="py-8" style="max-width: 1000px">
    <!-- Header -->
    <div class="d-flex align-center flex-wrap mb-6" style="gap: 12px">
      <v-btn
        icon="mdi-arrow-left"
        variant="text"
        :to="`/employees/${record.employeeId}`"
        class="flip-rtl"
      />
      <div>
        <h1 class="text-h4 font-weight-bold">
          {{ $t('offboarding.title') }} — {{ record.employee?.firstName }}
          {{ record.employee?.lastName }}
          <v-chip color="warning" variant="tonal" size="small" class="ms-2">
            {{ $t(`offboardingReasons.${record.reason}`) }}
          </v-chip>
        </h1>
        <p class="text-medium-emphasis mt-1">{{ record.employee?.employeeNo }}</p>
      </div>
      <v-spacer />
      <v-btn
        v-for="action in record.availableActions"
        :key="action"
        :color="ACTION_META[action]?.color"
        :prepend-icon="ACTION_META[action]?.icon"
        :loading="busy === action"
        variant="flat"
        @click="runAction(action)"
      >
        {{ $t(`offboardingActions.${action}`) }}
      </v-btn>
    </div>

    <!-- Stage stepper -->
    <v-card class="mb-6 pa-4">
      <v-stepper :model-value="currentStep + 1" alt-labels flat hide-actions>
        <v-stepper-header>
          <template v-for="(stage, i) in STAGES" :key="stage">
            <v-stepper-item
              :value="i + 1"
              :complete="currentStep > i || record.status === 'CLOSED'"
              :color="record.status === 'CANCELLED' ? 'grey' : undefined"
              :title="$t(`offboardingStatus.${stage}`)"
            />
            <v-divider v-if="i < STAGES.length - 1" />
          </template>
        </v-stepper-header>
      </v-stepper>
      <v-alert v-if="record.status === 'CANCELLED'" type="warning" variant="tonal" class="mt-2">
        {{ $t('offboardingStatus.CANCELLED') }}
      </v-alert>
    </v-card>

    <v-row>
      <v-col cols="12" md="6">
        <!-- Exit interview (resignations) -->
        <v-card v-if="record.exitInterviewSentAt" class="mb-4" :title="$t('offboarding.exitInterview')">
          <v-card-text>
            <template v-if="record.exitInterviewCompletedAt">
              <v-alert type="success" variant="tonal" density="compact" class="mb-3">
                {{ $t('offboarding.interviewDone') }}
              </v-alert>
              <div v-for="(answer, q) in record.exitInterviewData ?? {}" :key="q" class="mb-2">
                <div class="text-caption text-medium-emphasis">{{ $t(`exitInterview.${q}`, String(q)) }}</div>
                <div>{{ answer }}</div>
              </div>
            </template>
            <v-alert v-else type="info" variant="tonal" density="compact">
              {{ $t('offboarding.interviewPending') }}
            </v-alert>
          </v-card-text>
        </v-card>

        <!-- Asset return checklist -->
        <v-card :title="$t('offboarding.assetReturn')" class="mb-4">
          <v-card-text v-if="record.assets.items.length === 0" class="text-medium-emphasis">
            {{ $t('offboarding.noAssets') }}
          </v-card-text>
          <v-list v-else>
            <v-list-item v-for="item in record.assets.items" :key="item.id">
              <template #prepend>
                <v-icon
                  :icon="item.returnedAt ? 'mdi-check-circle' : 'mdi-progress-clock'"
                  :color="item.returnedAt ? 'success' : 'warning'"
                />
              </template>
              <v-list-item-title>{{ item.name }} ({{ item.type }})</v-list-item-title>
              <v-list-item-subtitle>
                {{ item.serialNumber ?? '—' }} ·
                {{ item.returnedAt ? $t('offboarding.returned') : $t('offboarding.notReturned') }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  v-if="!item.returnedAt && record.status === 'ASSETS_PENDING' && auth.hasRole('HR')"
                  size="small"
                  color="success"
                  variant="tonal"
                  :loading="busy === item.id"
                  @click="markReturned(item.id)"
                >
                  {{ $t('offboarding.markReturned') }}
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
          <v-card-text v-if="record.assets.unreturned > 0" class="pt-0">
            <v-alert type="warning" variant="tonal" density="compact">
              {{ $t('offboarding.unreturnedWarning', { n: record.assets.unreturned }) }}
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <!-- Settlement -->
        <v-card :title="$t('offboarding.settlement')">
          <v-card-text>
            <v-alert
              v-if="record.status !== 'SETTLEMENT' && !settlementEntered"
              type="info"
              variant="tonal"
              density="compact"
            >
              {{ $t('offboarding.settlementLater') }}
            </v-alert>
            <template v-else>
              <v-row dense>
                <v-col cols="6">
                  <v-text-field
                    v-model="settlement.workingDays"
                    :label="$t('offboarding.workingDays')"
                    type="number"
                    :readonly="record.status !== 'SETTLEMENT'"
                  />
                </v-col>
                <v-col cols="6">
                  <v-text-field
                    v-model="settlement.leaveDays"
                    :label="$t('offboarding.leaveDays')"
                    type="number"
                    :readonly="record.status !== 'SETTLEMENT'"
                  />
                </v-col>
                <v-col cols="6">
                  <v-text-field
                    v-model="settlement.deductions"
                    :label="$t('offboarding.deductions')"
                    type="number"
                    :readonly="record.status !== 'SETTLEMENT'"
                  />
                </v-col>
                <v-col cols="6">
                  <v-text-field
                    v-model="settlement.entitlements"
                    :label="$t('offboarding.entitlements')"
                    type="number"
                    :readonly="record.status !== 'SETTLEMENT'"
                  />
                </v-col>
                <v-col cols="12">
                  <v-textarea
                    v-model="settlement.notes"
                    :label="$t('assets.notes')"
                    rows="2"
                    :readonly="record.status !== 'SETTLEMENT'"
                  />
                </v-col>
              </v-row>
              <v-btn
                v-if="record.status === 'SETTLEMENT' && auth.hasRole('HR', 'FINANCE')"
                color="primary"
                :loading="busy === 'settlement'"
                :disabled="!settlement.workingDays || !settlement.entitlements"
                @click="saveSettlement"
              >
                {{ $t('common.save') }}
              </v-btn>
              <v-alert
                v-if="record.status === 'SETTLEMENT' && settlementEntered"
                type="info"
                variant="tonal"
                density="compact"
                class="mt-3"
              >
                {{ $t('offboarding.closeHint') }}
              </v-alert>
            </template>
          </v-card-text>
        </v-card>

        <v-alert
          v-if="record.closedAt"
          type="success"
          variant="tonal"
          class="mt-4"
          :text="$t('offboarding.closedAt', { date: new Date(record.closedAt).toLocaleString() })"
        />
      </v-col>
    </v-row>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>

  <v-container v-else class="py-16 text-center">
    <v-progress-circular indeterminate color="primary" size="48" />
  </v-container>
</template>

<style scoped>
[dir='rtl'] .flip-rtl {
  transform: scaleX(-1);
}
</style>
