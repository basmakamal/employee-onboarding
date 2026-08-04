<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client';

type CountMap = Record<string, number>;

interface DashboardData {
  trainees: CountMap;
  employees: CountMap;
  processes: { gosi: CountMap; medical: CountMap; criminal: CountMap };
  assetForms: CountMap;
  offboardings: CountMap;
  recent: Array<{
    id: string;
    entity: string;
    action: string;
    toStatus: string | null;
    actorType: string;
    at: string;
    subject: string | null;
  }>;
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
const OFFBOARDING_STAGES = ['REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT'];

const STAGE_COLORS: Record<string, string> = {
  CREATED: 'grey',
  AWAITING_FORM: 'orange',
  FORM_RECEIVED: 'blue',
  CONTRACT_CREATION: 'indigo',
  AWAITING_CONTRACT_APPROVAL: 'amber',
  EMPLOYEE_CREATED: 'success',
  EXPIRED: 'error',
};

const data = ref<DashboardData | null>(null);

const sum = (map: CountMap | undefined) =>
  Object.values(map ?? {}).reduce((a, b) => a + b, 0);

const stats = computed(() => [
  { key: 'trainees', icon: 'mdi-school', color: 'primary', value: sum(data.value?.trainees), to: '/trainees' },
  { key: 'activeEmployees', icon: 'mdi-badge-account', color: 'success', value: data.value?.employees['ACTIVE'] ?? 0, to: '/employees' },
  { key: 'openOffboardings', icon: 'mdi-exit-run', color: 'warning', value: OFFBOARDING_STAGES.reduce((a, s) => a + (data.value?.offboardings[s] ?? 0), 0), to: '/employees' },
  { key: 'pendingApprovals', icon: 'mdi-file-clock', color: 'indigo', value: (data.value?.trainees['AWAITING_CONTRACT_APPROVAL'] ?? 0) + (data.value?.assetForms['PENDING_EMPLOYEE_APPROVAL'] ?? 0), to: '/trainees' },
]);

function processSummary(map: CountMap | undefined) {
  return {
    done: map?.['DONE'] ?? 0,
    pending: (map?.['PENDING'] ?? 0) + (map?.['TRAINING'] ?? 0) + (map?.['REQUEST_SENT'] ?? 0),
    hold: map?.['ON_HOLD'] ?? 0,
  };
}

onMounted(async () => {
  data.value = await api.get<DashboardData>('/api/dashboard');
});
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('dashboard.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('app.tagline') }}</p>

    <template v-if="data">
      <!-- Stat tiles -->
      <v-row class="mb-2">
        <v-col v-for="(stat, i) in stats" :key="stat.key" cols="6" md="3">
          <v-card :to="stat.to" class="stat-card pa-2" :style="{ animationDelay: `${i * 80}ms` }" hover>
            <v-card-text class="d-flex align-center" style="gap: 14px">
              <v-avatar :color="stat.color" variant="tonal" size="52">
                <v-icon :icon="stat.icon" size="28" />
              </v-avatar>
              <div>
                <div class="text-h4 font-weight-bold">{{ stat.value }}</div>
                <div class="text-caption text-medium-emphasis">{{ $t(`dashboard.${stat.key}`) }}</div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="7">
          <!-- Stage 1: trainees by stage -->
          <v-card class="mb-4" :title="$t('dashboard.traineesByStage')">
            <v-card-text>
              <v-list density="compact">
                <v-list-item
                  v-for="stage in TRAINEE_STAGES.filter((s) => (data!.trainees[s] ?? 0) > 0)"
                  :key="stage"
                  to="/trainees"
                >
                  <template #prepend>
                    <v-badge :content="data!.trainees[stage]" :color="STAGE_COLORS[stage]" inline />
                  </template>
                  <v-list-item-title class="ms-2">{{ $t(`status.${stage}`) }}</v-list-item-title>
                </v-list-item>
                <div v-if="sum(data.trainees) === 0" class="text-medium-emphasis pa-4">
                  {{ $t('trainees.empty') }}
                </div>
              </v-list>
            </v-card-text>
          </v-card>

          <!-- Stage 2: process health -->
          <v-card class="mb-4" :title="$t('dashboard.processes')">
            <v-card-text>
              <v-row dense>
                <v-col v-for="kind in (['gosi', 'medical', 'criminal'] as const)" :key="kind" cols="12" sm="4">
                  <div class="text-subtitle-2 font-weight-bold mb-2">{{ $t(`processes.${kind}`) }}</div>
                  <div class="d-flex flex-wrap" style="gap: 6px">
                    <v-chip size="small" color="success" variant="tonal">
                      {{ $t('processStatus.DONE') }}: {{ processSummary(data.processes[kind]).done }}
                    </v-chip>
                    <v-chip size="small" color="orange" variant="tonal">
                      {{ $t('processStatus.PENDING') }}: {{ processSummary(data.processes[kind]).pending }}
                    </v-chip>
                    <v-chip
                      v-if="processSummary(data.processes[kind]).hold > 0"
                      size="small"
                      color="warning"
                      variant="tonal"
                    >
                      {{ $t('processStatus.ON_HOLD') }}: {{ processSummary(data.processes[kind]).hold }}
                    </v-chip>
                  </div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <!-- Stage 3: offboardings -->
          <v-card :title="$t('dashboard.offboardings')">
            <v-card-text>
              <div class="d-flex flex-wrap" style="gap: 6px">
                <v-chip
                  v-for="stage in OFFBOARDING_STAGES.filter((s) => (data!.offboardings[s] ?? 0) > 0)"
                  :key="stage"
                  color="warning"
                  variant="tonal"
                  size="small"
                >
                  {{ $t(`offboardingStatus.${stage}`) }}: {{ data!.offboardings[stage] }}
                </v-chip>
                <v-chip v-if="(data.offboardings['CLOSED'] ?? 0) > 0" color="grey" variant="tonal" size="small">
                  {{ $t('offboardingStatus.CLOSED') }}: {{ data.offboardings['CLOSED'] }}
                </v-chip>
                <span
                  v-if="sum(data.offboardings) === 0"
                  class="text-medium-emphasis"
                >
                  {{ $t('dashboard.noOffboardings') }}
                </span>
              </div>
            </v-card-text>
          </v-card>
        </v-col>

        <!-- Recent activity -->
        <v-col cols="12" md="5">
          <v-card :title="$t('dashboard.recent')">
            <v-list density="compact" lines="two">
              <v-list-item v-for="log in data.recent" :key="log.id">
                <v-list-item-title>
                  {{ $t(`entities.${log.entity}`, log.entity) }} —
                  {{ $t(`audit.${log.action}`, log.action) }}
                </v-list-item-title>
                <v-list-item-subtitle>
                  <template v-if="log.subject">{{ log.subject }} · </template>
                  {{ new Date(log.at).toLocaleString() }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <v-row v-else>
      <v-col class="text-center py-16">
        <v-progress-circular indeterminate color="primary" size="48" />
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.stat-card {
  animation: rise 0.45s ease both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
