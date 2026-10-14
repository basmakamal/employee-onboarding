<script setup lang="ts">
/**
 * Offboardings across the selected company — open ones by default, so the
 * people leaving and the step each case is at are visible in one place.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { errorText } from '../validation/errors';

interface Row {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  closedAt: string | null;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null };
}

const { t, locale } = useI18n();
const router = useRouter();
const companyName = useActiveCompanyName();
const STATUSES = ['REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT', 'CLOSED', 'CANCELLED'];
const status = ref('open');
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
    const params = new URLSearchParams({ page: String(page.value), limit: String(itemsPerPage.value), status: status.value });
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<{ items: Row[]; total: number }>(`/api/registers/offboardings?${params}`);
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

function openRow(_e: unknown, row: { item: Row }) {
  void router.push(`/offboardings/${row.item.id}`);
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value.startsWith('ar') ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const COLOR: Record<string, string> = { CLOSED: 'success', CANCELLED: 'grey', SETTLEMENT: 'warning' };

const headers = computed(() => [
  { title: t('fields.name'), key: 'employee', sortable: false },
  { title: t('offboarding.reason'), key: 'reason', sortable: false },
  { title: t('fields.status'), key: 'status', sortable: false },
  { title: t('registers.opened'), key: 'createdAt', sortable: false },
]);
</script>

<template>
  <v-container class="py-8">
    <PageHeader :title="$t('registers.offboardingsTitle')" :subtitle="$t('registers.offboardingsSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap ga-3 mb-4">
      <v-select
        v-model="status"
        :items="[{ title: $t('registers.openCases'), value: 'open' }, ...STATUSES.map((s) => ({ title: $t(`offboardingStatus.${s}`, s), value: s }))]"
        :label="$t('fields.status')"
        density="compact"
        hide-details
        style="max-width: 260px"
      />
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 300px" />
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
        hover
        @update:options="load"
        @click:row="openRow"
      >
        <template #item.employee="{ item }">
          <div class="font-weight-medium">{{ item.employee.firstName }} {{ item.employee.lastName }}</div>
          <div v-if="item.employee.employeeNo" class="text-caption text-medium-emphasis">{{ item.employee.employeeNo }}</div>
        </template>
        <template #item.reason="{ item }">{{ $t(`offboardingReasons.${item.reason}`, item.reason) }}</template>
        <template #item.status="{ item }">
          <v-chip size="small" variant="tonal" :color="COLOR[item.status] ?? 'info'">{{ $t(`offboardingStatus.${item.status}`, item.status) }}</v-chip>
        </template>
        <template #item.createdAt="{ item }">{{ fmt(item.createdAt) }}</template>
        <template #no-data>
          <EmptyState icon="log-out" :title="$t('registers.noOffboardings')" compact />
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>
</template>
