<script setup lang="ts">
/**
 * Contracts across the selected company: status, platform reference and the
 * term (start, duration, end). Salary is never listed here — it stays on the
 * employee file. Branch managers see their own branches only (server-side).
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { errorText } from '../validation/errors';

interface Row {
  id: string;
  status: string;
  externalRef: string | null;
  startDate: string | null;
  durationMonths: number | null;
  endDate: string | null;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null };
}

const { t, locale } = useI18n();
const companyName = useActiveCompanyName();
const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'EXPIRED'];
const status = ref<string | null>(null);
const q = ref('');
const page = ref(1);
const itemsPerPage = ref(25);
const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(itemsPerPage.value) });
    if (status.value) params.set('status', status.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<{ items: Row[]; total: number }>(`/api/registers/contracts?${params}`);
    rows.value = data.items;
    total.value = data.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => ((page.value = 1), void load()), 300);
});
watch(status, () => ((page.value = 1), void load()));

const fmt = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(locale.value.startsWith('ar') ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const daysTo = (d: string | null) => (d ? Math.ceil((new Date(`${d}T00:00:00Z`).getTime() - Date.now()) / 86_400_000) : null);
const COLOR: Record<string, string> = { DRAFT: 'grey', PENDING_APPROVAL: 'info', ACTIVE: 'success', REJECTED: 'error', EXPIRED: 'warning' };

const headers = computed(() => [
  { title: t('fields.name'), key: 'employee', sortable: false },
  { title: t('registers.contractStatus'), key: 'status', sortable: false },
  { title: t('contract.startDate'), key: 'startDate', sortable: false },
  { title: t('registers.endDate'), key: 'endDate', sortable: false },
  { title: t('contract.externalRef'), key: 'externalRef', sortable: false },
]);
</script>

<template>
  <v-container class="py-8">
    <PageHeader :title="$t('registers.contractsTitle')" :subtitle="$t('registers.contractsSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap ga-3 mb-4">
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 320px" />
      <v-select
        v-model="status"
        :items="STATUSES.map((s) => ({ title: $t(`contractStatus.${s}`, s), value: s }))"
        :label="$t('registers.contractStatus')"
        density="compact"
        hide-details
        clearable
        style="max-width: 240px"
      />
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-data-table-server
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="headers"
        :items="rows"
        :items-length="total"
        :loading="loading"
        item-value="id"
        @update:options="load"
      >
        <template #item.employee="{ item }">
          <router-link :to="`/employees/${item.employee.id}`" class="text-decoration-none">{{ item.employee.firstName }} {{ item.employee.lastName }}</router-link>
          <div v-if="item.employee.employeeNo" class="text-caption text-medium-emphasis">{{ item.employee.employeeNo }}</div>
        </template>
        <template #item.status="{ item }">
          <v-chip size="small" variant="tonal" :color="COLOR[item.status]">{{ $t(`contractStatus.${item.status}`, item.status) }}</v-chip>
        </template>
        <template #item.startDate="{ item }">{{ fmt(item.startDate) }}</template>
        <template #item.endDate="{ item }">
          <span>{{ fmt(item.endDate) }}</span>
          <v-chip
            v-if="item.status === 'ACTIVE' && daysTo(item.endDate) !== null && daysTo(item.endDate)! <= 60"
            size="x-small"
            variant="tonal"
            :color="daysTo(item.endDate)! < 0 ? 'error' : 'warning'"
            class="ms-2"
          >
            {{ daysTo(item.endDate)! < 0 ? $t('registers.ended') : $t('registers.endsIn', { n: daysTo(item.endDate) }) }}
          </v-chip>
        </template>
        <template #item.externalRef="{ item }"><span dir="ltr">{{ item.externalRef || '—' }}</span></template>
        <template #no-data>
          <EmptyState icon="file-signature" :title="$t('registers.noContracts')" compact />
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>
</template>
