<script setup lang="ts">
/**
 * Employees: one server-paged list for the whole lifecycle. Desktop gets a
 * table with sticky header, typed filters, selection and a bulk bar; phones
 * get the same rows as cards. Creating an employee is three short steps.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { api, ApiError } from '../api/client';
import StatusChip from '../components/StatusChip.vue';
import EntityCard from '../components/EntityCard.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import { useAuthStore } from '../stores/auth';
import { useConfirm } from '../composables/useConfirm';

interface EmployeeRow {
  id: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  status: string;
  hireDate?: string | null;
}

/** Server response: one page + the tab badge counts. */
interface EmployeePage {
  items: EmployeeRow[];
  total: number;
  counts: { all: number; onboarding: number; active: number; inactive: number };
}

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const confirm = useConfirm();
const display = useDisplay();

const employees = ref<EmployeeRow[]>([]);
const total = ref(0);
const counts = ref<EmployeePage['counts']>({ all: 0, onboarding: 0, active: 0, inactive: 0 });
const loading = ref(true);
const firstLoad = ref(true);
const snackbar = ref({ show: false, text: '', color: 'success' });

// Deep links from the dashboard and the command palette: ?new=1 opens the
// create dialog, ?filter= picks a lifecycle tab, ?status= narrows to one status.
const FILTERS = ['all', 'onboarding', 'active', 'inactive'] as const;
type Filter = (typeof FILTERS)[number];
const initialFilter = route.query['filter'] as string | undefined;
const filter = ref<Filter>(FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : 'all');
const statusFilter = ref<string>((route.query['status'] as string | undefined) ?? '');
const department = ref<string | null>(null);
const search = ref('');
const selected = ref<string[]>([]);

const hasFilters = computed(() => filter.value !== 'all' || !!statusFilter.value || !!department.value || !!search.value);

// v-data-table-server drives these; the server does the actual work.
const page = ref(1);
const itemsPerPage = ref(25);
const sortBy = ref<Array<{ key: string; order: 'asc' | 'desc' }>>([]);

/** Table column key → API sort field ('name' sorts by first name). */
const SORT_KEYS: Record<string, string> = {
  employeeNo: 'employeeNo',
  name: 'firstName',
  email: 'email',
  department: 'department',
  status: 'status',
  hireDate: 'hireDate',
};

/** Known departments / projects / job titles — a value typed once joins the list for everyone. */
type FieldOptions = { departments: string[]; jobTitles: string[]; projects: string[] };
const options = ref<FieldOptions>({ departments: [], jobTitles: [], projects: [] });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

/** Fetch the current page from the server — search/filter/sort included. */
async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      filter: filter.value,
      page: String(page.value),
      limit: String(itemsPerPage.value),
    });
    if (search.value.trim()) params.set('q', search.value.trim());
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (department.value) params.set('department', department.value);
    const sort = sortBy.value[0];
    if (sort && SORT_KEYS[sort.key]) {
      params.set('sortBy', SORT_KEYS[sort.key] as string);
      params.set('sortDir', sort.order);
    }
    const data = await api.get<EmployeePage>(`/api/employees?${params}`);
    employees.value = data.items;
    total.value = data.total;
    counts.value = data.counts;
  } finally {
    loading.value = false;
    firstLoad.value = false;
  }
}

/** The table drives page/size/sort; one handler reloads from the server. */
function onTableOptions(opts: { page: number; itemsPerPage: number; sortBy: Array<{ key: string; order: 'asc' | 'desc' }> }) {
  page.value = opts.page;
  itemsPerPage.value = opts.itemsPerPage;
  sortBy.value = opts.sortBy;
  void load();
}

// Filter changes restart from page 1. Search debounces so the server sees
// one query per pause, not one per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(filter, () => {
  statusFilter.value = ''; // a lifecycle tab replaces any single-status deep link
  page.value = 1;
  selected.value = [];
  void load();
});
watch(department, () => {
  page.value = 1;
  void load();
});
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});

function clearFilters() {
  filter.value = 'all';
  statusFilter.value = '';
  department.value = null;
  search.value = '';
}

async function loadOptions() {
  options.value = await api.get<FieldOptions>('/api/employees/options');
}

function fullName(e: EmployeeRow) {
  return `${e.firstName} ${e.lastName}`;
}
function initials(e: EmployeeRow) {
  return `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase();
}
function openRow(_e: unknown, row: { item: EmployeeRow }) {
  void router.push(`/employees/${row.item.id}`);
}

// ------------------------------------------------------------- bulk actions
const bulkBusy = ref(false);

/** Send the data form to every selected record still at "Created". */
async function bulkSendForm() {
  const eligible = employees.value.filter((e) => selected.value.includes(e.id) && e.status === 'CREATED');
  if (eligible.length === 0) {
    notify(t('employees.bulkNoneEligible'), 'warning');
    return;
  }
  if (!(await confirm({ title: t('employees.bulkSendForm'), message: t('employees.selected', { n: eligible.length }) }))) return;
  bulkBusy.value = true;
  try {
    for (const e of eligible) await api.post(`/api/employees/${e.id}/actions/send-form`, {});
    notify(t('employees.bulkSent', { n: eligible.length }));
    selected.value = [];
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    bulkBusy.value = false;
  }
}

/** A CSV of the selected rows — the columns on screen, nothing hidden. */
function bulkExport() {
  const rows = employees.value.filter((e) => selected.value.includes(e.id));
  const head = [t('employees.no'), t('fields.name'), t('fields.email'), t('fields.department'), t('fields.jobTitle'), t('fields.status')];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head, ...rows.map((e) => [e.employeeNo ?? '', fullName(e), e.email, e.department ?? '', e.jobTitle ?? '', t(`status.${e.status}`)])]
    .map((r) => r.map(esc).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'employees.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------- hard delete (ADMIN)
async function removeEmployee(target: EmployeeRow) {
  const ok = await confirm({
    title: t('profile.delete'),
    message: `${t('profile.deleteWarning')} — ${fullName(target)}${target.employeeNo ? ` · ${target.employeeNo}` : ''}`,
    color: 'error',
    confirmText: t('profile.deleteConfirm'),
    icon: 'trash-2',
  });
  if (!ok) return;
  try {
    await api.delete(`/api/employees/${target.id}`);
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  }
}

// ------------------------------------------------------------- create (3 steps)
const dialog = ref(route.query['new'] === '1');
const step = ref(1);
const saving = ref(false);
const error = ref('');
const form = ref({
  mode: 'onboarding' as 'onboarding' | 'direct',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  nationalId: '',
  department: '' as string | null,
  project: '' as string | null,
  jobTitle: '' as string | null,
  hireDate: '',
  preferredLanguage: 'AR' as 'AR' | 'EN',
});
const sendFormNow = ref(true);

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email.trim()));
const emailError = computed(() => (form.value.email && !emailValid.value ? [t('employees.invalidEmail')] : []));
const step1Ok = computed(() => !!form.value.firstName.trim() && !!form.value.lastName.trim() && emailValid.value);
const step3Ok = computed(() => form.value.mode === 'onboarding' || !!form.value.hireDate);

function openCreate() {
  step.value = 1;
  error.value = '';
  dialog.value = true;
}

watch(dialog, (open) => {
  if (!open) {
    step.value = 1;
    error.value = '';
  }
});

async function createEmployee() {
  saving.value = true;
  error.value = '';
  try {
    const body: Record<string, unknown> = { direct: form.value.mode === 'direct', preferredLanguage: form.value.preferredLanguage };
    for (const [k, v] of Object.entries(form.value)) {
      // comboboxes emit null when cleared — only keep real text
      if (k !== 'mode' && k !== 'preferredLanguage' && typeof v === 'string' && v.trim()) body[k] = v.trim();
    }
    if (form.value.mode === 'onboarding') {
      delete body['hireDate']; // set on activation
      body['sendForm'] = sendFormNow.value;
    }
    const created = await api.post<EmployeeRow>('/api/employees', body);
    dialog.value = false;
    await router.push(`/employees/${created.id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
  } finally {
    saving.value = false;
  }
}

const headers = computed(() => [
  { title: t('fields.name'), key: 'name', sortable: true },
  { title: t('fields.department'), key: 'department' },
  { title: t('fields.status'), key: 'status' },
  { title: t('employees.no'), key: 'employeeNo', width: 120 },
  { title: '', key: 'actions', sortable: false, width: 56, align: 'end' as const },
]);

// The table's initial @update:options fires load(); options load in parallel.
onMounted(loadOptions);
</script>

<template>
  <v-container class="py-6 py-md-8" style="max-width: 1240px">
    <!-- ───── header ───── -->
    <div class="d-flex align-center flex-wrap ga-3 mb-5">
      <div class="flex-grow-1">
        <h1 class="text-h4 font-weight-bold">{{ $t('employees.title') }}</h1>
        <p class="text-body-2 text-medium-emphasis mt-1 mb-0">{{ $t('employees.subtitle') }}</p>
      </div>
      <v-btn v-if="auth.hasRole('HR')" color="primary" prepend-icon="plus" @click="openCreate">
        {{ $t('employees.new') }}
      </v-btn>
    </div>

    <!-- ───── filters ───── -->
    <v-card class="mb-3 pa-3 pa-sm-4">
      <div class="d-flex flex-wrap align-center ga-2">
        <v-text-field
          v-model="search"
          :placeholder="$t('employees.searchPlaceholder')"
          prepend-inner-icon="search"
          density="compact"
          hide-details
          clearable
          class="filters__search"
        />
        <v-select
          v-model="department"
          :items="[{ title: $t('employees.allDepartments'), value: null }, ...options.departments.map((d) => ({ title: d, value: d }))]"
          :label="$t('fields.department')"
          density="compact"
          hide-details
          class="filters__dept"
        />
        <v-btn v-if="hasFilters" variant="text" size="small" prepend-icon="x" @click="clearFilters">
          {{ $t('employees.clearFilters') }}
        </v-btn>
      </div>
      <div class="d-flex align-center flex-wrap ga-2 mt-3">
        <v-chip-group v-model="filter" mandatory selected-class="chip-on" class="filters__tabs">
          <v-chip v-for="key in FILTERS" :key="key" :value="key" variant="tonal" size="small" class="font-weight-medium">
            {{ $t(`employees.filters.${key}`) }}
            <span class="ms-1 text-medium-emphasis tnum">{{ counts[key] }}</span>
          </v-chip>
        </v-chip-group>
        <v-chip v-if="statusFilter" size="small" color="primary" closable @click:close="statusFilter = ''; load()">
          {{ $t(`status.${statusFilter}`, statusFilter) }}
        </v-chip>
        <v-spacer />
        <span class="text-caption text-medium-emphasis tnum">
          {{ $t('employees.resultsCount', { n: employees.length, total }) }}
        </span>
      </div>
    </v-card>

    <!-- ───── bulk bar ───── -->
    <v-slide-y-transition>
      <v-card v-if="selected.length" class="bulk mb-3 px-4 py-2 d-flex align-center flex-wrap ga-2">
        <span class="text-body-2 font-weight-semibold">{{ $t('employees.selected', { n: selected.length }) }}</span>
        <v-btn v-if="auth.hasRole('HR')" size="small" variant="tonal" prepend-icon="send" :loading="bulkBusy" @click="bulkSendForm">
          {{ $t('employees.bulkSendForm') }}
        </v-btn>
        <v-btn size="small" variant="tonal" prepend-icon="download" @click="bulkExport">{{ $t('employees.bulkExport') }}</v-btn>
        <v-spacer />
        <v-btn size="small" variant="text" @click="selected = []">{{ $t('common.cancel') }}</v-btn>
      </v-card>
    </v-slide-y-transition>

    <!-- ───── phone: cards ───── -->
    <template v-if="display.smAndDown.value">
      <SkeletonBlock v-if="firstLoad" variant="list" :rows="6" />
      <div v-else class="d-flex flex-column ga-2">
        <EntityCard
          v-for="e in employees"
          :key="e.id"
          :to="`/employees/${e.id}`"
          :title="fullName(e)"
          :subtitle="[e.jobTitle, e.department].filter(Boolean).join(' · ') || e.email"
          :initials="initials(e)"
          :chip="{ text: $t(`status.${e.status}`), color: undefined }"
          :meta="e.employeeNo ?? e.email"
        />
        <div v-if="employees.length === 0" class="text-center text-medium-emphasis py-10">{{ $t('employees.empty') }}</div>
        <v-pagination
          v-if="total > itemsPerPage"
          :model-value="page"
          :length="Math.ceil(total / itemsPerPage)"
          density="comfortable"
          rounded="lg"
          class="mt-2"
          @update:model-value="(p: number) => onTableOptions({ page: p, itemsPerPage, sortBy })"
        />
      </div>
    </template>

    <!-- ───── desktop: table ───── -->
    <v-card v-else class="grid">
      <v-data-table-server
        v-model="selected"
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="headers"
        :items="employees"
        :items-length="total"
        :loading="loading"
        item-value="id"
        show-select
        hover
        class="grid__table"
        @click:row="openRow"
        @update:options="onTableOptions"
      >
        <template #item.name="{ item }">
          <div class="d-flex align-center ga-3 py-1">
            <v-avatar size="34" color="secondary" variant="tonal">
              <span class="text-caption font-weight-bold">{{ initials(item) }}</span>
            </v-avatar>
            <div class="min-w-0">
              <div class="text-body-2 font-weight-semibold text-truncate">{{ fullName(item) }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ item.jobTitle ?? item.email }}</div>
            </div>
          </div>
        </template>
        <template #item.department="{ item }">
          <span class="text-body-2">{{ item.department ?? '—' }}</span>
        </template>
        <template #item.status="{ item }">
          <StatusChip :status="item.status" />
        </template>
        <template #item.employeeNo="{ item }">
          <span class="tnum text-body-2">{{ item.employeeNo ?? '—' }}</span>
        </template>
        <template #item.actions="{ item }">
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="ellipsis-vertical" variant="text" size="small" :aria-label="$t('common.more')" @click.stop />
            </template>
            <v-list density="compact" min-width="200">
              <v-list-item prepend-icon="external-link" :title="$t('employees.openProfile')" :to="`/employees/${item.id}`" />
              <v-list-item
                v-if="auth.user?.role === 'ADMIN'"
                prepend-icon="trash-2"
                :title="$t('profile.delete')"
                base-color="error"
                @click="removeEmployee(item)"
              />
            </v-list>
          </v-menu>
        </template>
        <template #loading>
          <SkeletonBlock variant="table" :rows="8" class="pa-4" />
        </template>
        <template #no-data>
          <div class="pa-10 text-center text-medium-emphasis">{{ $t('employees.empty') }}</div>
        </template>
      </v-data-table-server>
    </v-card>

    <!-- ───── create: three steps ───── -->
    <v-dialog v-model="dialog" max-width="640" :fullscreen="display.smAndDown.value" scrollable>
      <v-card class="create">
        <div class="px-6 pt-6 pb-2">
          <div class="d-flex align-center ga-3">
            <div class="flex-grow-1">
              <h2 class="text-h6 font-weight-bold">{{ $t('employees.new') }}</h2>
              <p class="text-caption text-medium-emphasis mb-0">
                {{ step === 1 ? $t('employees.step1Hint') : step === 2 ? $t('employees.step2Hint') : $t('employees.step3Hint') }}
              </p>
            </div>
            <v-btn icon="x" variant="text" size="small" :aria-label="$t('common.cancel')" @click="dialog = false" />
          </div>
          <div class="stepper mt-4">
            <div v-for="n in 3" :key="n" class="stepper__step" :class="{ 'stepper__step--done': step > n, 'stepper__step--now': step === n }">
              <span class="stepper__no"><v-icon v-if="step > n" icon="check" size="12" /><template v-else>{{ n }}</template></span>
              <span class="text-caption font-weight-medium">{{ $t(`employees.step${n}`) }}</span>
            </div>
          </div>
        </div>

        <v-card-text class="px-6 pt-4">
          <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>

          <v-window v-model="step" :touch="false">
            <v-window-item :value="1">
              <v-row dense>
                <v-col cols="12" sm="6"><v-text-field v-model="form.firstName" :label="$t('fields.firstName')" autofocus /></v-col>
                <v-col cols="12" sm="6"><v-text-field v-model="form.lastName" :label="$t('fields.lastName')" /></v-col>
                <v-col cols="12"><v-text-field v-model="form.email" :label="$t('fields.email')" type="email" dir="ltr" prepend-inner-icon="mail" :error-messages="emailError" /></v-col>
                <v-col cols="12" sm="6"><v-text-field v-model="form.phone" :label="$t('fields.phone')" dir="ltr" prepend-inner-icon="phone" /></v-col>
                <v-col cols="12" sm="6"><v-text-field v-model="form.nationalId" :label="$t('fields.nationalId')" dir="ltr" prepend-inner-icon="id-card" /></v-col>
                <v-col cols="12">
                  <v-select
                    v-model="form.preferredLanguage"
                    :items="[{ title: $t('languages.AR'), value: 'AR' }, { title: $t('languages.EN'), value: 'EN' }]"
                    :label="$t('fields.preferredLanguage')"
                    :hint="$t('fields.preferredLanguageHint')"
                    persistent-hint
                    prepend-inner-icon="languages"
                  />
                </v-col>
              </v-row>
            </v-window-item>

            <v-window-item :value="2">
              <v-row dense>
                <v-col cols="12" sm="6">
                  <v-combobox v-model="form.department" :items="options.departments" :label="$t('fields.department')" :hint="$t('fields.comboHint')" persistent-hint clearable />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-combobox v-model="form.jobTitle" :items="options.jobTitles" :label="$t('fields.jobTitle')" :hint="$t('fields.comboHint')" persistent-hint clearable />
                </v-col>
                <v-col cols="12">
                  <v-combobox v-model="form.project" :items="options.projects" :label="$t('employees.project')" :hint="$t('fields.comboHint')" persistent-hint clearable />
                </v-col>
              </v-row>
            </v-window-item>

            <v-window-item :value="3">
              <div class="mode">
                <button type="button" class="mode__opt" :class="{ 'mode__opt--on': form.mode === 'onboarding' }" @click="form.mode = 'onboarding'">
                  <v-icon icon="graduation-cap" size="20" />
                  <span class="text-body-2 font-weight-semibold">{{ $t('onboarding.newHire') }}</span>
                  <span class="text-caption text-medium-emphasis">{{ $t('onboarding.newHireHint') }}</span>
                </button>
                <button type="button" class="mode__opt" :class="{ 'mode__opt--on': form.mode === 'direct' }" @click="form.mode = 'direct'">
                  <v-icon icon="id-card" size="20" />
                  <span class="text-body-2 font-weight-semibold">{{ $t('onboarding.existing') }}</span>
                  <span class="text-caption text-medium-emphasis">{{ $t('employees.directHint') }}</span>
                </button>
              </div>
              <v-text-field v-if="form.mode === 'direct'" v-model="form.hireDate" :label="$t('employees.hireDate')" type="date" class="mt-4" />
              <v-switch v-else v-model="sendFormNow" color="primary" hide-details class="mt-3">
                <template #label>
                  <div class="ms-2">
                    <div class="text-body-2 font-weight-medium">{{ $t('onboarding.sendNow') }}</div>
                    <div class="text-caption text-medium-emphasis">{{ $t('onboarding.docsHint') }}</div>
                  </div>
                </template>
              </v-switch>

              <div class="well mt-4 px-4 py-3">
                <div class="label-caps mb-2">{{ $t('employees.reviewTitle') }}</div>
                <div class="text-body-2 font-weight-semibold">{{ form.firstName }} {{ form.lastName }}</div>
                <div class="text-caption text-medium-emphasis" dir="ltr">{{ form.email }}</div>
                <div class="text-caption text-medium-emphasis mt-1">
                  {{ [form.jobTitle, form.department, form.project].filter(Boolean).join(' · ') || '—' }}
                  · {{ $t(`languages.${form.preferredLanguage}`) }}
                </div>
              </div>
            </v-window-item>
          </v-window>
        </v-card-text>

        <v-card-actions class="px-6 pb-5 pt-2">
          <v-btn v-if="step > 1" variant="text" prepend-icon="arrow-left" class="flip-icon" @click="step -= 1">{{ $t('employees.back') }}</v-btn>
          <v-spacer />
          <v-btn v-if="step < 3" color="primary" variant="flat" class="px-5" :disabled="step === 1 && !step1Ok" append-icon="arrow-right" @click="step += 1">
            {{ $t('employees.continue') }}
          </v-btn>
          <v-btn v-else color="primary" variant="flat" class="px-5" :loading="saving" :disabled="!step1Ok || !step3Ok" @click="createEmployee">
            {{ form.mode === 'onboarding' && sendFormNow ? $t('employees.createAndSend') : $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.filters__search { flex: 1 1 260px; min-width: 200px; }
.filters__dept { flex: 0 1 220px; min-width: 180px; }
.filters__tabs :deep(.chip-on) { background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary)); }
.bulk { background: rgba(var(--v-theme-primary), 0.08) !important; border-color: rgba(var(--v-theme-primary), 0.25) !important; }
.grid { overflow: hidden; }
.grid__table :deep(tbody tr) { cursor: pointer; }
.grid__table :deep(td) { height: 60px !important; }

.stepper { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stepper__step {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.stepper__no {
  width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600;
  background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.stepper__step--now { background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }
.stepper__step--now .stepper__no { background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); border-color: transparent; }
.stepper__step--done { color: rgb(var(--v-theme-success)); }
.stepper__step--done .stepper__no { background: rgb(var(--v-theme-success)); color: #fff; border-color: transparent; }

.mode { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.mode__opt {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px; text-align: start;
  border-radius: 14px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; cursor: pointer;
  transition: border-color 160ms var(--app-ease), background 160ms var(--app-ease);
}
.mode__opt--on { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.08); }
.mode__opt:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
[dir='rtl'] .flip-icon :deep(.v-icon) { transform: scaleX(-1); }
</style>
