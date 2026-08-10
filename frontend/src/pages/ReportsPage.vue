<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import StatusChip from '../components/StatusChip.vue';

type CountMap = Record<string, number>;

interface Summary {
  headcountByDepartment: Array<{ department: string; active: number; inactive: number }>;
  onboardingFunnel: CountMap;
  processes: { gosi: CountMap; medical: CountMap; criminal: CountMap };
  assetForms: CountMap;
  unreturnedAssetItems: number;
  offboardingByReason: CountMap;
  expiringDocuments: { expired: number; in30: number; in60: number; in90: number };
}

interface EmployeeRow {
  id: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  status: string;
  hireDate: string | null;
  createdAt: string;
}

const PIPELINE = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
];

const FUNNEL_STAGES = [...PIPELINE.slice(0, 5), 'ACTIVE', 'EXPIRED'];

const router = useRouter();
const data = ref<Summary | null>(null);
const employees = ref<EmployeeRow[]>([]);
const downloading = ref('');

// ------------------------------------------------------------------ filters
const search = ref('');
const from = ref('');
const to = ref('');
const basis = ref<'hireDate' | 'createdAt'>('hireDate');
const statusFilter = ref<string | null>(null);

const hasFilters = computed(
  () => !!(search.value || from.value || to.value || statusFilter.value),
);

function clearFilters() {
  search.value = '';
  from.value = '';
  to.value = '';
  statusFilter.value = null;
}

/** Stat cards / funnel rows toggle the table's status filter. */
function toggleStatus(value: string) {
  statusFilter.value = statusFilter.value === value ? null : value;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const fromMs = from.value ? new Date(from.value).getTime() : null;
  // The "to" day is inclusive — push it to the end of that day.
  const toMs = to.value ? new Date(to.value).getTime() + 86_399_999 : null;

  return employees.value.filter((e) => {
    if (statusFilter.value === 'ONBOARDING') {
      if (!PIPELINE.includes(e.status)) return false;
    } else if (statusFilter.value && e.status !== statusFilter.value) {
      return false;
    }

    if (q) {
      const haystack =
        `${e.firstName} ${e.lastName} ${e.email} ${e.employeeNo ?? ''} ${e.department ?? ''} ${e.jobTitle ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    if (fromMs !== null || toMs !== null) {
      const raw = basis.value === 'hireDate' ? e.hireDate : e.createdAt;
      if (!raw) return false; // no hire date yet → outside any hire-date range
      const ts = new Date(raw).getTime();
      if (fromMs !== null && ts < fromMs) return false;
      if (toMs !== null && ts > toMs) return false;
    }
    return true;
  });
});

// ------------------------------------------------------------------ totals
const totals = computed(() => ({
  active: employees.value.filter((e) => e.status === 'ACTIVE').length,
  onboarding: employees.value.filter((e) => PIPELINE.includes(e.status)).length,
  inactive: employees.value.filter((e) => e.status === 'INACTIVE').length,
  expiring: (data.value?.expiringDocuments.expired ?? 0) + (data.value?.expiringDocuments.in30 ?? 0),
}));

const maxDept = computed(() =>
  Math.max(1, ...(data.value?.headcountByDepartment.map((d) => d.active + d.inactive) ?? [1])),
);
const funnelTotal = computed(() =>
  Math.max(1, Object.values(data.value?.onboardingFunnel ?? {}).reduce((a, b) => a + b, 0)),
);

function pct(map: CountMap | undefined, key: string): number {
  const total = Object.values(map ?? {}).reduce((a, b) => a + b, 0);
  return total === 0 ? 0 : Math.round(((map?.[key] ?? 0) / total) * 100);
}

function fmt(date: string | null): string {
  return date ? new Date(date).toLocaleDateString() : '—';
}

function openEmployee(_e: unknown, row: { item: EmployeeRow }) {
  void router.push(`/employees/${row.item.id}`);
}

// ------------------------------------------------------------------ exports
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
  [data.value, employees.value] = await Promise.all([
    api.get<Summary>('/api/reports/summary'),
    api.get<EmployeeRow[]>('/api/employees'),
  ]);
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
        v-for="exp in ['employees', 'onboarding', 'expiring-documents', 'audit']"
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
      <!-- Clickable totals -->
      <v-row class="mb-1">
        <v-col
          v-for="card in [
            { key: 'active', value: totals.active, icon: 'mdi-badge-account', color: 'success', filter: 'ACTIVE' },
            { key: 'onboarding', value: totals.onboarding, icon: 'mdi-school', color: 'primary', filter: 'ONBOARDING' },
            { key: 'inactive', value: totals.inactive, icon: 'mdi-account-off', color: 'grey', filter: 'INACTIVE' },
            { key: 'expiring', value: totals.expiring, icon: 'mdi-file-clock', color: 'warning', filter: null },
          ]"
          :key="card.key"
          cols="6"
          md="3"
        >
          <v-card
            class="pa-1"
            :variant="card.filter && statusFilter === card.filter ? 'tonal' : 'elevated'"
            :color="card.filter && statusFilter === card.filter ? card.color : undefined"
            hover
            @click="card.filter ? toggleStatus(card.filter) : undefined"
          >
            <v-card-text class="d-flex align-center" style="gap: 14px">
              <v-avatar :color="card.color" variant="tonal" size="48">
                <v-icon :icon="card.icon" size="26" />
              </v-avatar>
              <div>
                <div class="text-h4 font-weight-bold">{{ card.value }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ $t(`reports.totals.${card.key}`) }}
                </div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Employees by name: search + duration filter, rows open the profile -->
      <v-card class="mb-6">
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="mdi-account-search" class="me-2" color="primary" />
            {{ $t('reports.people') }}
            <v-chip size="small" variant="tonal" class="ms-2">{{ filtered.length }}</v-chip>
          </v-card-title>
        </v-card-item>
        <v-card-text class="pb-0">
          <v-row dense>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="search"
                :label="$t('reports.filters.search')"
                prepend-inner-icon="mdi-magnify"
                density="compact"
                clearable
                hide-details
              />
            </v-col>
            <v-col cols="6" md="2">
              <v-text-field
                v-model="from"
                :label="$t('reports.filters.from')"
                type="date"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="6" md="2">
              <v-text-field
                v-model="to"
                :label="$t('reports.filters.to')"
                type="date"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="8" md="3">
              <v-select
                v-model="basis"
                :items="[
                  { title: $t('reports.filters.basisHire'), value: 'hireDate' },
                  { title: $t('reports.filters.basisCreated'), value: 'createdAt' },
                ]"
                :label="$t('reports.filters.basis')"
                density="compact"
                hide-details
              />
            </v-col>
            <v-col cols="4" md="1" class="d-flex align-center">
              <v-btn
                v-if="hasFilters"
                variant="text"
                size="small"
                color="error"
                @click="clearFilters"
              >
                {{ $t('reports.filters.clear') }}
              </v-btn>
            </v-col>
          </v-row>
        </v-card-text>
        <v-data-table
          :headers="[
            { title: $t('employees.no'), key: 'employeeNo' },
            { title: $t('fields.name'), key: 'name', sortable: false },
            { title: $t('fields.department'), key: 'department' },
            { title: $t('fields.jobTitle'), key: 'jobTitle' },
            { title: $t('fields.status'), key: 'status' },
            { title: $t('employees.hireDate'), key: 'hireDate' },
          ]"
          :items="filtered"
          items-per-page="10"
          hover
          @click:row="openEmployee"
        >
          <template #item.employeeNo="{ item }">
            <span class="font-weight-bold">{{ item.employeeNo ?? '—' }}</span>
          </template>
          <template #item.name="{ item }">{{ item.firstName }} {{ item.lastName }}</template>
          <template #item.department="{ item }">{{ item.department ?? '—' }}</template>
          <template #item.jobTitle="{ item }">{{ item.jobTitle ?? '—' }}</template>
          <template #item.status="{ item }">
            <StatusChip :status="item.status" />
          </template>
          <template #item.hireDate="{ item }">{{ fmt(item.hireDate) }}</template>
          <template #no-data>
            <div class="pa-8 text-medium-emphasis">{{ $t('employees.empty') }}</div>
          </template>
        </v-data-table>
      </v-card>

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

        <!-- Onboarding funnel — rows filter the table above -->
        <v-col cols="12" md="6">
          <v-card :title="$t('reports.funnel')" class="h-100">
            <v-card-text>
              <div
                v-for="stage in FUNNEL_STAGES.filter((s) => (data!.onboardingFunnel[s] ?? 0) > 0)"
                :key="stage"
                class="mb-3 funnel-row"
                role="button"
                @click="toggleStatus(stage)"
              >
                <div class="d-flex justify-space-between text-body-2 mb-1">
                  <span :class="statusFilter === stage ? 'font-weight-bold text-primary' : ''">
                    {{ $t(`status.${stage}`) }}
                  </span>
                  <span class="font-weight-medium">{{ data!.onboardingFunnel[stage] }}</span>
                </div>
                <v-progress-linear
                  :model-value="((data!.onboardingFunnel[stage] ?? 0) / funnelTotal) * 100"
                  :color="stage === 'EXPIRED' ? 'error' : stage === 'ACTIVE' ? 'success' : 'indigo'"
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

<style scoped>
.funnel-row {
  cursor: pointer;
}
</style>
