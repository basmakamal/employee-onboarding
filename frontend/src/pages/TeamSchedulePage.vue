<script setup lang="ts">
/**
 * Team schedule: who works what over one or two weeks, for the active people
 * the user may see (a branch manager: their branches). Filter by branch or
 * department and by name; each row opens the employee's schedule.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import ScheduleStrip, { type Day } from '../components/ScheduleStrip.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useOrgOptions } from '../composables/useOrgOptions';
import { errorText } from '../validation/errors';

interface Row {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string | null;
  orgUnit: { nameAr: string; nameEn: string } | null;
  days: Day[];
}

const { locale } = useI18n();
const companyName = useActiveCompanyName();
const org = useOrgOptions();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Weeks start on Sunday (Saudi working week). */
function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  return ymd(x);
}
const from = ref(weekStart());
const span = ref<7 | 14>(7);
const unit = ref<string | null>(null);
const q = ref('');
const page = ref(1);
const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');

const to = computed(() => {
  const d = new Date(`${from.value}T00:00:00`);
  d.setDate(d.getDate() + span.value - 1);
  return ymd(d);
});
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value, page: String(page.value), limit: '50' });
    if (unit.value) params.set('orgUnitId', unit.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<{ items: Row[]; total: number }>(`/api/workforce/team-schedule?${params}`);
    rows.value = data.items;
    total.value = data.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
function move(weeks: number) {
  const d = new Date(`${from.value}T00:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  from.value = ymd(d);
}
onMounted(() => {
  void org.load();
  void load();
});
let timer: ReturnType<typeof setTimeout> | undefined;
watch([from, span, unit], () => ((page.value = 1), void load()));
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => ((page.value = 1), void load()), 300);
});
watch(page, () => void load());

const ar = computed(() => locale.value.startsWith('ar'));
const todayYmd = ymd(new Date());
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA' : 'en-GB', { weekday: 'short', timeZone: 'UTC' });
const dayNum = (d: string) => Number(d.slice(8, 10));
const range = computed(() => {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${f(from.value)} – ${f(to.value)}`;
});
</script>

<template>
  <v-container class="py-8" fluid style="max-width: 1500px">
    <PageHeader :title="$t('schedule.teamTitle')" :subtitle="$t('schedule.teamSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-btn icon="chevron-left" variant="text" class="flip-rtl" :aria-label="$t('schedule.earlier')" @click="move(-1)" />
      <span class="text-body-1 font-weight-medium">{{ range }}</span>
      <v-btn icon="chevron-right" variant="text" class="flip-rtl" :aria-label="$t('schedule.later')" @click="move(1)" />
      <v-btn variant="text" size="small" @click="from = weekStart()">{{ $t('schedule.thisWeek') }}</v-btn>
      <v-btn-toggle v-model="span" mandatory density="compact" variant="outlined" color="primary">
        <v-btn :value="7">{{ $t('schedule.oneWeek') }}</v-btn>
        <v-btn :value="14">{{ $t('schedule.twoWeeks') }}</v-btn>
      </v-btn-toggle>
      <v-select v-model="unit" :items="org.unitItems.value" :label="$t('fields.orgUnit')" density="compact" hide-details clearable style="max-width: 260px" />
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 240px" />
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-if="!loading && rows.length === 0" icon="calendar" :title="$t('schedule.teamEmpty')" compact />
      <div v-else class="grid-wrap">
        <div class="grid-row grid-head">
          <span />
          <div class="head-strip">
            <div v-for="d in rows[0]?.days ?? []" :key="d.date" class="head-cell" :class="{ 'head-cell--today': d.date === todayYmd }">
              <span class="font-weight-bold">{{ weekday(d.date) }}</span>
              <span>{{ dayNum(d.date) }}</span>
            </div>
          </div>
        </div>
        <div v-for="r in rows" :key="r.id" class="grid-row">
          <router-link :to="`/employees/${r.id}`" class="grid-name text-decoration-none">
            <div class="text-body-2 font-weight-medium text-truncate">{{ r.firstName }} {{ r.lastName }}</div>
            <div class="text-caption text-medium-emphasis text-truncate">{{ r.orgUnit ? (ar ? r.orgUnit.nameAr : r.orgUnit.nameEn) : r.employeeNo }}</div>
          </router-link>
          <ScheduleStrip :days="r.days" compact />
        </div>
      </div>
      <div v-if="total > 50" class="d-flex justify-center py-2">
        <v-pagination v-model="page" :length="Math.ceil(total / 50)" density="compact" />
      </div>
    </v-card>
  </v-container>
</template>

<style scoped>
.grid-wrap { overflow-x: auto; padding: 8px 12px; }
.grid-row { display: grid; grid-template-columns: 200px auto; align-items: center; gap: 12px; padding: 6px 0; }
.grid-row + .grid-row { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.grid-name { color: inherit; min-width: 0; }
.grid-head { padding-top: 0; }
.head-strip { display: flex; gap: 4px; }
.head-cell { width: 46px; flex: 0 0 46px; display: flex; flex-direction: column; align-items: center; font-size: 11px; color: rgba(var(--v-theme-on-surface), 0.6); }
.head-cell--today { color: rgb(var(--v-theme-primary)); }
</style>
