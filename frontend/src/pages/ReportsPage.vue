<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';

type CountMap = Record<string, number>;

interface Summary {
  headcountByDepartment: Array<{ department: string; active: number; inactive: number }>;
  traineeFunnel: CountMap;
  processes: { gosi: CountMap; medical: CountMap; criminal: CountMap };
  assetForms: CountMap;
  unreturnedAssetItems: number;
  offboardingByReason: CountMap;
  expiringDocuments: { expired: number; in30: number; in60: number; in90: number };
}

const TRAINEE_STAGES = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EMPLOYEE_CREATED',
  'EXPIRED',
];

const { t } = useI18n();
const data = ref<Summary | null>(null);
const downloading = ref('');

const maxDept = computed(() =>
  Math.max(1, ...(data.value?.headcountByDepartment.map((d) => d.active + d.inactive) ?? [1])),
);
const funnelTotal = computed(() =>
  Math.max(1, Object.values(data.value?.traineeFunnel ?? {}).reduce((a, b) => a + b, 0)),
);

function pct(map: CountMap | undefined, key: string): number {
  const total = Object.values(map ?? {}).reduce((a, b) => a + b, 0);
  return total === 0 ? 0 : Math.round(((map?.[key] ?? 0) / total) * 100);
}

async function download(kind: string, extra = '') {
  downloading.value = kind;
  try {
    const res = await fetch(`/api/reports/export/${kind}${extra}`, {
      credentials: 'include',
      headers: authHeader(),
    });
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    downloading.value = '';
  }
}

// The api client keeps the token privately; for blob downloads we go
// through a normal fetch and reuse its refresh cookie via credentials.
import { getAccessToken } from '../api/client';
function authHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

onMounted(async () => {
  data.value = await api.get<Summary>('/api/reports/summary');
});
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <div class="d-flex align-center flex-wrap mb-6" style="gap: 8px">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('reports.title') }}</h1>
        <p class="text-medium-emphasis mt-1">{{ $t('reports.subtitle') }}</p>
      </div>
      <v-spacer />
      <v-btn
        v-for="exp in ['employees', 'trainees', 'expiring-documents', 'audit']"
        :key="exp"
        variant="tonal"
        color="primary"
        size="small"
        prepend-icon="mdi-microsoft-excel"
        :loading="downloading === exp"
        @click="download(exp, exp === 'audit' ? '?days=30' : '')"
      >
        {{ $t(`reports.exports.${exp}`) }}
      </v-btn>
    </div>

    <template v-if="data">
      <v-row>
        <!-- Headcount -->
        <v-col cols="12" md="6">
          <v-card :title="$t('reports.headcount')" class="h-100">
            <v-card-text>
              <div v-for="dept in data.headcountByDepartment" :key="dept.department" class="mb-3">
                <div class="d-flex justify-space-between text-body-2 mb-1">
                  <span class="font-weight-medium">{{ dept.department }}</span>
                  <span>
                    {{ dept.active }} {{ $t('employees.statuses.ACTIVE') }}
                    <span v-if="dept.inactive" class="text-medium-emphasis">
                      + {{ dept.inactive }} {{ $t('employees.statuses.INACTIVE') }}
                    </span>
                  </span>
                </div>
                <v-progress-linear
                  :model-value="((dept.active + dept.inactive) / maxDept) * 100"
                  color="primary"
                  height="8"
                  rounded
                />
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Trainee funnel -->
        <v-col cols="12" md="6">
          <v-card :title="$t('reports.funnel')" class="h-100">
            <v-card-text>
              <div
                v-for="stage in TRAINEE_STAGES.filter((s) => (data!.traineeFunnel[s] ?? 0) > 0)"
                :key="stage"
                class="mb-3"
              >
                <div class="d-flex justify-space-between text-body-2 mb-1">
                  <span>{{ $t(`status.${stage}`) }}</span>
                  <span class="font-weight-medium">{{ data!.traineeFunnel[stage] }}</span>
                </div>
                <v-progress-linear
                  :model-value="((data!.traineeFunnel[stage] ?? 0) / funnelTotal) * 100"
                  :color="stage === 'EXPIRED' ? 'error' : stage === 'EMPLOYEE_CREATED' ? 'success' : 'indigo'"
                  height="8"
                  rounded
                />
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Process completion -->
        <v-col cols="12" md="6">
          <v-card :title="$t('reports.completion')" class="h-100">
            <v-card-text>
              <div v-for="kind in (['gosi', 'medical', 'criminal'] as const)" :key="kind" class="mb-3">
                <div class="d-flex justify-space-between text-body-2 mb-1">
                  <span>{{ $t(`processes.${kind}`) }}</span>
                  <span class="font-weight-medium">{{ pct(data.processes[kind], 'DONE') }}%</span>
                </div>
                <v-progress-linear
                  :model-value="pct(data.processes[kind], 'DONE')"
                  color="success"
                  height="8"
                  rounded
                />
              </div>
              <v-divider class="my-3" />
              <div class="d-flex flex-wrap" style="gap: 6px">
                <v-chip size="small" variant="tonal" color="success">
                  {{ $t('assetStatus.APPROVED') }}: {{ data.assetForms['APPROVED'] ?? 0 }}
                </v-chip>
                <v-chip v-if="data.unreturnedAssetItems" size="small" variant="tonal" color="warning">
                  {{ $t('offboarding.notReturned') }}: {{ data.unreturnedAssetItems }}
                </v-chip>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Expiring documents + offboarding reasons -->
        <v-col cols="12" md="6">
          <v-card :title="$t('reports.expiry')" class="h-100">
            <v-card-text>
              <v-row dense class="text-center mb-2">
                <v-col v-for="(value, key) in data.expiringDocuments" :key="key" cols="3">
                  <div
                    class="text-h4 font-weight-bold"
                    :class="key === 'expired' ? 'text-error' : key === 'in30' ? 'text-warning' : ''"
                  >
                    {{ value }}
                  </div>
                  <div class="text-caption text-medium-emphasis">{{ $t(`reports.buckets.${key}`) }}</div>
                </v-col>
              </v-row>
              <v-divider class="my-3" />
              <div class="text-subtitle-2 font-weight-bold mb-2">{{ $t('reports.offReasons') }}</div>
              <div class="d-flex flex-wrap" style="gap: 6px">
                <v-chip
                  v-for="(count, reason) in data.offboardingByReason"
                  :key="reason"
                  size="small"
                  variant="tonal"
                  color="warning"
                >
                  {{ $t(`offboardingReasons.${reason}`, String(reason)) }}: {{ count }}
                </v-chip>
                <span v-if="Object.keys(data.offboardingByReason).length === 0" class="text-medium-emphasis">
                  {{ $t('dashboard.noOffboardings') }}
                </span>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>
  </v-container>
</template>
