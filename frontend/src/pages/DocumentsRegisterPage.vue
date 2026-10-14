<script setup lang="ts">
/**
 * Expiry-tracked documents (Iqama, passport, work permit…) across the
 * selected company: what has expired and what is due soon. Document
 * numbers stay on the employee file; this list is for follow-up.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useListsStore } from '../stores/lists';
import { errorText } from '../validation/errors';

interface Row {
  id: string;
  type: string;
  expiryDate: string;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null };
}

const { t, locale } = useI18n();
const lists = useListsStore();
const companyName = useActiveCompanyName();
const window_ = ref<'expired' | '30' | '60' | '90' | 'all'>('30');
const type = ref<string | null>(null);
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
    const params = new URLSearchParams({ page: String(page.value), limit: String(itemsPerPage.value), window: window_.value });
    if (type.value) params.set('type', type.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<{ items: Row[]; total: number }>(`/api/registers/documents?${params}`);
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
watch([window_, type], () => ((page.value = 1), void load()));

const days = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
const color = (iso: string) => (days(iso) < 0 ? 'error' : days(iso) <= 30 ? 'warning' : 'success');
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value.startsWith('ar') ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

const headers = computed(() => [
  { title: t('fields.name'), key: 'employee', sortable: false },
  { title: t('registers.docType'), key: 'type', sortable: false },
  { title: t('expiryDocs.expiry'), key: 'expiryDate', sortable: false },
  { title: '', key: 'left', sortable: false, align: 'end' as const },
]);
</script>

<template>
  <v-container class="py-8">
    <PageHeader :title="$t('registers.documentsTitle')" :subtitle="$t('registers.documentsSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap ga-3 mb-4 align-center">
      <v-btn-toggle v-model="window_" mandatory color="primary" variant="outlined" density="comfortable">
        <v-btn value="expired">{{ $t('registers.expired') }}</v-btn>
        <v-btn value="30">{{ $t('registers.within', { n: 30 }) }}</v-btn>
        <v-btn value="90">{{ $t('registers.within', { n: 90 }) }}</v-btn>
        <v-btn value="all">{{ $t('registers.all') }}</v-btn>
      </v-btn-toggle>
      <v-select v-model="type" :items="lists.items('DOC_TYPE')" :label="$t('registers.docType')" density="compact" hide-details clearable style="max-width: 220px" />
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 280px" />
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
        <template #item.type="{ item }">{{ lists.label('DOC_TYPE', item.type) ?? item.type }}</template>
        <template #item.expiryDate="{ item }">{{ fmt(item.expiryDate) }}</template>
        <template #item.left="{ item }">
          <v-chip size="small" variant="tonal" :color="color(item.expiryDate)">
            {{ days(item.expiryDate) < 0 ? $t('registers.expiredAgo', { n: -days(item.expiryDate) }) : $t('registers.endsIn', { n: days(item.expiryDate) }) }}
          </v-chip>
        </template>
        <template #no-data>
          <EmptyState icon="id-card" :title="$t('registers.noDocuments')" compact />
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>
</template>
