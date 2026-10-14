<script setup lang="ts">
/**
 * Transfers & promotions across the selected company: what is scheduled to
 * take effect, what has been applied, and what was cancelled or could not be
 * applied. Branch managers see only their own branches' people (the server
 * filters). Each change opens the employee's file.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useListsStore } from '../stores/lists';
import { errorText } from '../validation/errors';

interface Snap { id?: string | null; code?: string | null; ar?: string | null; en?: string | null }
interface Change {
  id: string;
  batchId: string;
  category: string;
  oldValue: Snap | null;
  newValue: Snap | null;
  effectiveDate: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED' | 'FAILED';
  reason: string | null;
  failReason: string | null;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null };
  approvedBy: { id: string; name: string } | null;
}

const { t, locale } = useI18n();
const lists = useListsStore();
const companyName = useActiveCompanyName();
const view = ref<'SCHEDULED' | 'APPLIED' | 'OTHER'>('SCHEDULED');
const rows = ref<Change[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const qs = view.value === 'OTHER' ? '' : `?status=${view.value}`;
    const data = await api.get<Change[]>(`/api/employees/changes${qs}`);
    rows.value = view.value === 'OTHER' ? data.filter((r) => r.status === 'CANCELLED' || r.status === 'FAILED') : data;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(view, load);

const ar = computed(() => locale.value.startsWith('ar'));
function text(category: string, s: Snap | null): string {
  if (!s || (!s.id && !s.code && !s.ar && !s.en)) return t('history.none');
  if (category === 'EMPLOYMENT_TYPE') return s.code ? t(`profile.types.${s.code}`, s.code) : t('history.none');
  if (category === 'STATUS') return s.code ? (lists.label('EMPLOYEE_STATUS', s.code) ?? s.code) : t('history.none');
  if (category === 'HIRE_DATE') return s.code ?? t('history.none');
  return (ar.value ? s.ar : s.en) || s.code || t('history.removed');
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const STATUS_COLOR: Record<string, string> = { SCHEDULED: 'info', APPLIED: 'success', CANCELLED: 'grey', FAILED: 'error' };

const headers = computed(() => [
  { title: t('history.effectiveDate'), key: 'effectiveDate', width: 140 },
  { title: t('fields.name'), key: 'employee' },
  { title: t('history.change'), key: 'change' },
  { title: t('history.reason'), key: 'reason' },
  { title: t('history.statusCol'), key: 'status', width: 130 },
]);
</script>

<template>
  <v-container class="py-8">
    <PageHeader :title="$t('history.pageTitle')" :subtitle="$t('history.pageSubtitle', { company: companyName })" />

    <v-btn-toggle v-model="view" mandatory color="primary" variant="outlined" density="comfortable" class="mb-4">
      <v-btn value="SCHEDULED">{{ $t('history.viewUpcoming') }}</v-btn>
      <v-btn value="APPLIED">{{ $t('history.viewApplied') }}</v-btn>
      <v-btn value="OTHER">{{ $t('history.viewOther') }}</v-btn>
    </v-btn-toggle>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-data-table :headers="headers" :items="rows" :loading="loading" item-value="id" :items-per-page="25">
        <template #item.effectiveDate="{ item }">
          <span class="text-no-wrap">{{ fmtDate(item.effectiveDate) }}</span>
        </template>
        <template #item.employee="{ item }">
          <router-link :to="`/employees/${item.employee.id}`" class="text-decoration-none">
            {{ item.employee.firstName }} {{ item.employee.lastName }}
          </router-link>
          <div v-if="item.employee.employeeNo" class="text-caption text-medium-emphasis">{{ item.employee.employeeNo }}</div>
        </template>
        <template #item.change="{ item }">
          <span class="text-medium-emphasis">{{ $t(`history.categories.${item.category}`) }}:</span>
          {{ text(item.category, item.oldValue) }} → <b>{{ text(item.category, item.newValue) }}</b>
        </template>
        <template #item.reason="{ item }">
          <div class="text-body-2">{{ item.reason || '—' }}</div>
          <div v-if="item.failReason" class="text-caption text-error">{{ item.failReason }}</div>
          <div v-if="item.approvedBy" class="text-caption text-medium-emphasis">{{ $t('history.by', { name: item.approvedBy.name }) }}</div>
        </template>
        <template #item.status="{ item }">
          <v-chip size="small" :color="STATUS_COLOR[item.status]" variant="tonal">{{ $t(`history.status.${item.status}`) }}</v-chip>
        </template>
        <template #no-data>
          <EmptyState icon="arrow-left-right" :title="$t('history.pageEmpty')" :hint="$t('history.pageEmptyHint')" compact />
        </template>
      </v-data-table>
    </v-card>
  </v-container>
</template>
