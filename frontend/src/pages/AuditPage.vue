<script setup lang="ts">
/**
 * The audit trail of the selected company: who did what, when, from where
 * (web, signed link, scheduler) and — for edits — what each field was before
 * and after. Read-only by design: nothing here changes or deletes an entry.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useListsStore } from '../stores/lists';
import { errorText } from '../validation/errors';

interface Entry {
  id: string;
  at: string;
  entity: string;
  entityId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: 'USER' | 'LINK' | 'SYSTEM';
  metadata: Record<string, unknown> | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  source: string | null;
  requestId: string | null;
  actor: { id: string; name: string } | null;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null } | null;
}

const { t, te, locale } = useI18n();
const lists = useListsStore();
const companyName = useActiveCompanyName();
const facets = ref<{ entities: string[]; actions: string[] }>({ entities: [], actions: [] });
const filters = ref({ entity: null as string | null, action: null as string | null, source: null as string | null, from: '', to: '', q: '' });
const page = ref(1);
const itemsPerPage = ref(50);
const rows = ref<Entry[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    facets.value = await api.get('/api/audit/facets');
  } catch {
    /* the filters simply stay empty */
  }
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const f = filters.value;
    const params = new URLSearchParams({ page: String(page.value), limit: String(itemsPerPage.value) });
    for (const [k, v] of Object.entries(f)) if (v) params.set(k, String(v).trim());
    const data = await api.get<{ items: Entry[]; total: number }>(`/api/audit?${params}`);
    rows.value = data.items;
    total.value = data.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  filters,
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((page.value = 1), void load()), 300);
  },
  { deep: true },
);

const ar = computed(() => locale.value.startsWith('ar'));
const label = (prefix: string, code: string) => (te(`${prefix}.${code}`) ? t(`${prefix}.${code}`) : code);
const statusText = (s: string | null) => (s ? (lists.label('EMPLOYEE_STATUS', s) ?? s) : '');
const fieldLabel = (f: string) => (te(`fields.${f}`) ? t(`fields.${f}`) : te(`errors.fields.${f}`) ? t(`errors.fields.${f}`) : f);
const val = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const when = (iso: string) => new Date(iso).toLocaleString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const who = (e: Entry) => e.actor?.name ?? (e.actorType === 'LINK' ? t('auditTrail.byLink') : t('auditTrail.bySystem'));
const SOURCE_COLOR: Record<string, string> = { WEB: 'primary', LINK: 'info', SCHEDULER: 'warning', SYSTEM: 'grey' };
const meta = (e: Entry) => {
  const m = e.metadata ?? {};
  const keys = Object.keys(m).filter((k) => k !== 'fields');
  return keys.length ? keys.map((k) => `${k}: ${val(m[k])}`).join(' · ') : '';
};

const headers = computed(() => [
  { title: t('auditTrail.when'), key: 'at', sortable: false, width: 170 },
  { title: t('auditTrail.who'), key: 'who', sortable: false },
  { title: t('auditTrail.what'), key: 'what', sortable: false },
  { title: t('auditTrail.employee'), key: 'employee', sortable: false },
  { title: t('auditTrail.details'), key: 'details', sortable: false },
]);
</script>

<template>
  <v-container class="py-8">
    <PageHeader :title="$t('auditTrail.title')" :subtitle="$t('auditTrail.subtitle', { company: companyName })" />

    <div class="filters mb-4">
      <v-select v-model="filters.entity" :items="facets.entities.map((e) => ({ title: label('entities', e), value: e }))" :label="$t('auditTrail.record')" density="compact" hide-details clearable />
      <v-autocomplete v-model="filters.action" :items="facets.actions.map((a) => ({ title: label('audit', a), value: a }))" :label="$t('auditTrail.action')" density="compact" hide-details clearable />
      <v-select v-model="filters.source" :items="['WEB', 'LINK', 'SCHEDULER', 'SYSTEM'].map((s) => ({ title: $t(`auditTrail.sources.${s}`), value: s }))" :label="$t('auditTrail.source')" density="compact" hide-details clearable />
      <v-text-field v-model="filters.from" type="date" :label="$t('auditTrail.from')" density="compact" hide-details />
      <v-text-field v-model="filters.to" type="date" :label="$t('auditTrail.to')" density="compact" hide-details />
      <v-text-field v-model="filters.q" :label="$t('auditTrail.search')" prepend-inner-icon="search" density="compact" hide-details clearable />
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
        density="compact"
        @update:options="load"
      >
        <template #item.at="{ item }"><span class="text-no-wrap">{{ when(item.at) }}</span></template>
        <template #item.who="{ item }">
          <div class="text-body-2">{{ who(item) }}</div>
          <v-chip v-if="item.source" size="x-small" variant="tonal" :color="SOURCE_COLOR[item.source] ?? 'grey'">{{ $t(`auditTrail.sources.${item.source}`) }}</v-chip>
        </template>
        <template #item.what="{ item }">
          <div class="text-body-2 font-weight-medium">{{ label('audit', item.action) }}</div>
          <div class="text-caption text-medium-emphasis">
            {{ label('entities', item.entity) }}
            <template v-if="item.fromStatus || item.toStatus"> · {{ statusText(item.fromStatus) }} → {{ statusText(item.toStatus) }}</template>
          </div>
        </template>
        <template #item.employee="{ item }">
          <router-link v-if="item.employee" :to="`/employees/${item.employee.id}`" class="text-decoration-none">
            {{ item.employee.firstName }} {{ item.employee.lastName }}
          </router-link>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #item.details="{ item }">
          <div v-for="(c, f) in item.changes ?? {}" :key="f" class="text-caption">
            <span class="text-medium-emphasis">{{ fieldLabel(String(f)) }}:</span> {{ val(c.from) }} → <b>{{ val(c.to) }}</b>
          </div>
          <div v-if="meta(item)" class="text-caption text-medium-emphasis text-truncate" style="max-width: 360px" :title="meta(item)">{{ meta(item) }}</div>
        </template>
        <template #no-data>
          <EmptyState icon="history" :title="$t('auditTrail.empty')" compact />
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
</style>
