<script setup lang="ts">
/**
 * Employees: one server-paged list for the whole lifecycle. Desktop gets a
 * table with sticky header, typed filters, selection and a bulk bar; phones
 * get the same rows as cards. Creating an employee is three short steps.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { errorText } from '../validation/errors';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { api } from '../api/client';
import StatusChip from '../components/StatusChip.vue';
import EntityCard from '../components/EntityCard.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import PageHeader from '../components/PageHeader.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useForm } from '../composables/useForm';
import { rules } from '../validation/rules';
import { useOrgOptions } from '../composables/useOrgOptions';
import EmptyState from '../components/EmptyState.vue';
import { useAuthStore } from '../stores/auth';
import { useListsStore } from '../stores/lists';
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
const lists = useListsStore();

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
/** One of six soft tints, always the same for the same person. */
function avatarTone(e: EmployeeRow): string {
  let h = 0;
  for (const ch of `${e.firstName}${e.lastName}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `avatar-tone avatar-tone-${h % 6}`;
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
    notify(errorText(e), 'error');
  } finally {
    bulkBusy.value = false;
  }
}

/** Send the data form again to every selected record still waiting for it. */
async function bulkResendForm() {
  const eligible = employees.value.filter(
    (e) => selected.value.includes(e.id) && e.status === 'AWAITING_FORM',
  );
  if (eligible.length === 0) {
    notify(t('employees.bulkNoneAwaiting'), 'warning');
    return;
  }
  if (!(await confirm({ title: t('employees.bulkResendForm'), message: t('employees.selected', { n: eligible.length }) }))) return;
  bulkBusy.value = true;
  try {
    for (const e of eligible) await api.post(`/api/employees/${e.id}/actions/resend-form`, {});
    notify(t('employees.bulkResent', { n: eligible.length }));
    selected.value = [];
    await load();
  } catch (e) {
    notify(errorText(e), 'error');
  } finally {
    bulkBusy.value = false;
  }
}

/** Row-level resend — the same thing for one person, from the row menu. */
async function resendForm(target: EmployeeRow) {
  const ok = await confirm({
    title: t('actions.RESEND_FORM'),
    message: t('employees.resendFormConfirm', { name: fullName(target), email: target.email }),
    confirmText: t('actions.RESEND_FORM'),
    icon: 'mail-plus',
  });
  if (!ok) return;
  try {
    await api.post(`/api/employees/${target.id}/actions/resend-form`, {});
    notify(t('employees.resendFormDone'));
    await load();
  } catch (e) {
    notify(errorText(e), 'error');
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
    notify(errorText(e), 'error');
  }
}

// ------------------------------------------------------------- create (3 steps)
const dialog = ref(route.query['new'] === '1');
const step = ref(1);
const createForm = useForm();
const org = useOrgOptions();
const form = ref({
  mode: 'onboarding' as 'onboarding' | 'direct',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  nationalId: '',
  // Placement inside the selected company (ids; the server re-validates each one).
  orgUnitId: null as string | null,
  positionId: null as string | null,
  managerId: null as string | null,
  project: '' as string | null,
  hireDate: '',
  preferredLanguage: 'AR' as 'AR' | 'EN',
});
const sendFormNow = ref(true);

/**
 * The wizard shows one step at a time, so a step's fields are checked in code
 * when Continue / Create is pressed: the bad fields turn red and the alert
 * says what to fix. A server refusal is shown on its field, and the wizard
 * jumps back to the step that holds that field.
 */
const STEP_OF: Record<string, number> = {
  firstName: 1, lastName: 1, email: 1, phone: 1, nationalId: 1, preferredLanguage: 1,
  orgUnitId: 2, positionId: 2, managerId: 2, project: 2,
  hireDate: 3,
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stepProblems(n: number): Record<string, string[]> {
  const f = form.value;
  const req = [t('errors.field.required')];
  const out: Record<string, string[]> = {};
  if (n === 1) {
    if (!f.firstName.trim()) out['firstName'] = req;
    if (!f.lastName.trim()) out['lastName'] = req;
    if (!f.email.trim()) out['email'] = req;
    else if (!EMAIL_RE.test(f.email.trim())) out['email'] = [t('errors.field.email')];
  }
  if (n === 3 && f.mode === 'direct' && !f.hireDate) out['hireDate'] = req;
  return out;
}

/** Checks the given steps; on a problem, opens the first failing step and marks its fields. */
function checkSteps(...steps: number[]): boolean {
  for (const n of steps) {
    const problems = stepProblems(n);
    if (Object.keys(problems).length) {
      step.value = n;
      createForm.invalid(problems);
      return false;
    }
  }
  return true;
}

function nextStep() {
  if (!checkSteps(step.value)) return;
  createForm.reset();
  step.value += 1;
}

function openCreate() {
  step.value = 1;
  createForm.reset();
  dialog.value = true;
}

watch(dialog, (open) => {
  if (!open) {
    step.value = 1;
    createForm.reset();
    return;
  }
  // However the dialog was opened (button or ?new=1), the placement options must be there.
  void org.load();
});

async function createEmployee() {
  if (!checkSteps(1, 3)) return;
  await createForm.submit(async () => {
    const body: Record<string, unknown> = {
      direct: form.value.mode === 'direct',
      preferredLanguage: form.value.preferredLanguage,
      orgUnitId: form.value.orgUnitId,
      positionId: form.value.positionId,
      managerId: form.value.managerId,
    };
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
  });
  // Refused by the server: show the step that holds the first bad field.
  const first = Object.keys(createForm.fields.value).map((k) => STEP_OF[k.split('.')[0] ?? '']).find(Boolean);
  if (first) step.value = first;
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
    <PageHeader :title="$t('employees.title')" :subtitle="$t('employees.subtitle')">
      <v-btn v-if="auth.can('employees.write')" color="primary" prepend-icon="plus" @click="openCreate">
        {{ $t('employees.new') }}
      </v-btn>
    </PageHeader>

    <!-- ───── lifecycle tabs ───── -->
    <v-chip-group v-model="filter" mandatory selected-class="pill-on" class="filter-pills mb-5">
      <v-chip v-for="key in FILTERS" :key="key" :value="key" :ripple="false">
        {{ $t(`employees.filters.${key}`) }}
        <span class="pill-count tnum">{{ counts[key] }}</span>
      </v-chip>
    </v-chip-group>

    <!-- ───── toolbar ───── -->
    <div class="dir-tools mb-3">
      <v-text-field
        v-model="search"
        :placeholder="$t('employees.searchPlaceholder')"
        prepend-inner-icon="search"
        density="compact"
        hide-details
        clearable
        class="dir-tools__search"
      />
      <v-select
        v-model="department"
        :items="[{ title: $t('employees.allDepartments'), value: null }, ...options.departments.map((d) => ({ title: lists.label('DEPARTMENT', d) ?? d, value: d }))]"
        density="compact"
        hide-details
        class="dir-tools__dept"
      />
      <v-chip v-if="statusFilter" size="small" variant="tonal" closable @click:close="statusFilter = ''; load()">
        {{ $t(`status.${statusFilter}`, statusFilter) }}
      </v-chip>
      <v-btn v-if="hasFilters" variant="text" size="small" @click="clearFilters">
        {{ $t('employees.clearFilters') }}
      </v-btn>
      <v-spacer />
      <span class="text-caption text-medium-emphasis tnum">
        {{ $t('employees.resultsCount', { n: employees.length, total }) }}
      </span>
    </div>

    <!-- ───── bulk bar ───── -->
    <v-slide-y-transition>
      <div v-if="selected.length" class="bulk mb-3 px-4 py-2 d-flex align-center flex-wrap ga-2">
        <span class="text-body-2 font-weight-semibold">{{ $t('employees.selected', { n: selected.length }) }}</span>
        <v-btn v-if="auth.can('onboarding.manage')" size="small" variant="tonal" prepend-icon="send" :loading="bulkBusy" @click="bulkSendForm">
          {{ $t('employees.bulkSendForm') }}
        </v-btn>
        <v-btn v-if="auth.can('onboarding.manage')" size="small" variant="tonal" prepend-icon="mail-plus" :loading="bulkBusy" @click="bulkResendForm">
          {{ $t('employees.bulkResendForm') }}
        </v-btn>
        <v-btn size="small" variant="tonal" prepend-icon="download" @click="bulkExport">{{ $t('employees.bulkExport') }}</v-btn>
        <v-spacer />
        <v-btn size="small" variant="text" @click="selected = []">{{ $t('common.cancel') }}</v-btn>
      </div>
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
          :avatar-class="avatarTone(e)"
          :chip="{ text: $t(`status.${e.status}`), color: undefined }"
          :meta="e.employeeNo ?? e.email"
        />
        <EmptyState
          v-if="employees.length === 0"
          icon="users"
          :title="hasFilters ? $t('employees.noMatchTitle') : $t('employees.emptyTitle')"
          :hint="hasFilters ? $t('employees.noMatchHint') : $t('employees.emptyHint')"
        />
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
            <v-avatar size="32" :class="avatarTone(item)">
              <span style="font-size: 12px">{{ initials(item) }}</span>
            </v-avatar>
            <div class="min-w-0">
              <div class="text-body-2 font-weight-semibold text-truncate">{{ fullName(item) }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ item.jobTitle ?? item.email }}</div>
            </div>
          </div>
        </template>
        <template #item.department="{ item }">
          <span class="text-body-2">{{ (item.department && (lists.label('DEPARTMENT', item.department) ?? item.department)) || '—' }}</span>
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
                v-if="auth.can('onboarding.manage') && item.status === 'AWAITING_FORM'"
                prepend-icon="mail-plus"
                :title="$t('actions.RESEND_FORM')"
                @click="resendForm(item)"
              />
              <v-list-item
                v-if="auth.can('employees.delete')"
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
          <EmptyState
            icon="users"
            :title="hasFilters ? $t('employees.noMatchTitle') : $t('employees.emptyTitle')"
            :hint="hasFilters ? $t('employees.noMatchHint') : $t('employees.emptyHint')"
          >
            <v-btn v-if="!hasFilters && auth.can('employees.write')" color="primary" size="small" prepend-icon="plus" @click="openCreate">
              {{ $t('employees.new') }}
            </v-btn>
            <v-btn v-else-if="hasFilters" variant="tonal" size="small" @click="clearFilters">{{ $t('employees.clearFilters') }}</v-btn>
          </EmptyState>
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
          <FormErrorAlert :form="createForm" />

          <v-window v-model="step" :touch="false">
            <v-window-item :value="1">
              <v-row dense>
                <v-col cols="12" sm="6"><v-text-field v-model="form.firstName" :label="$t('fields.firstName') + ' *'" :rules="[rules.required, rules.maxLength(100)]" :error-messages="createForm.errorsFor('firstName')" autofocus /></v-col>
                <v-col cols="12" sm="6"><v-text-field v-model="form.lastName" :label="$t('fields.lastName') + ' *'" :rules="[rules.required, rules.maxLength(100)]" :error-messages="createForm.errorsFor('lastName')" /></v-col>
                <v-col cols="12"><v-text-field v-model="form.email" :label="$t('fields.email') + ' *'" type="email" dir="ltr" prepend-inner-icon="mail" :rules="[rules.required, rules.email]" :error-messages="createForm.errorsFor('email')" /></v-col>
                <v-col cols="12" sm="6"><v-text-field v-model="form.phone" :label="$t('fields.phone')" dir="ltr" prepend-inner-icon="phone" :error-messages="createForm.errorsFor('phone')" /></v-col>
                <v-col cols="12" sm="6"><v-text-field v-model="form.nationalId" :label="$t('fields.nationalId')" dir="ltr" prepend-inner-icon="id-card" :error-messages="createForm.errorsFor('nationalId')" /></v-col>
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
                  <v-select v-model="form.orgUnitId" :items="org.unitItems.value" :label="$t('fields.orgUnit')" :hint="org.hasUnits.value ? '' : $t('fields.orgNone')" persistent-hint clearable :error-messages="createForm.errorsFor('orgUnitId')" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="form.positionId" :items="org.titleItems.value" :label="$t('fields.position')" :hint="org.hasTitles.value ? '' : $t('fields.titlesNone')" persistent-hint clearable :error-messages="createForm.errorsFor('positionId')" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-autocomplete
                    v-model="form.managerId"
                    :items="org.managerHits.value"
                    :label="$t('fields.manager')"
                    :hint="$t('fields.managerHint')"
                    persistent-hint
                    clearable
                    no-filter
                    :error-messages="createForm.errorsFor('managerId')"
                    @update:search="(q: string) => org.searchManagers(q)"
                  />
                </v-col>
                <v-col cols="12">
                  <v-combobox v-model="form.project" :items="lists.items('PROJECT')" item-title="title" item-value="value" :return-object="false" :label="$t('employees.project')" :hint="$t('fields.comboHint')" persistent-hint clearable />
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
              <v-text-field v-if="form.mode === 'direct'" v-model="form.hireDate" :label="$t('employees.hireDate') + ' *'" type="date" class="mt-4" :rules="[rules.required]" :error-messages="createForm.errorsFor('hireDate')" />
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
                  {{ [org.titleItems.value.find((t) => t.value === form.positionId)?.title, org.unitItems.value.find((u) => u.value === form.orgUnitId)?.title?.replace(/^(— )+/, ''), form.project].filter(Boolean).join(' · ') || '—' }}
                  · {{ $t(`languages.${form.preferredLanguage}`) }}
                </div>
              </div>
            </v-window-item>
          </v-window>
        </v-card-text>

        <v-card-actions class="px-6 pb-5 pt-2">
          <v-btn v-if="step > 1" variant="text" prepend-icon="arrow-left" class="flip-icon" @click="createForm.reset(); step -= 1">{{ $t('employees.back') }}</v-btn>
          <v-spacer />
          <v-btn v-if="step < 3" color="primary" variant="flat" class="px-5" append-icon="arrow-right" @click="nextStep">
            {{ $t('employees.continue') }}
          </v-btn>
          <v-btn v-else color="primary" variant="flat" class="px-5" :loading="createForm.busy.value" @click="createEmployee">
            {{ form.mode === 'onboarding' && sendFormNow ? $t('employees.createAndSend') : $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.dir-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px !important; }
.dir-tools__search { flex: 1 1 260px; min-width: 200px; max-width: 420px; }
.dir-tools__dept { flex: 0 1 220px; min-width: 180px; }
.bulk {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: var(--r-md);
}
.grid { overflow: hidden; }
.grid__table :deep(tbody tr) { cursor: pointer; }
.grid__table :deep(td) { height: 54px !important; }
.grid__table :deep(thead th:first-child), .grid__table :deep(tbody td:first-child) { padding-inline-end: 0; width: 44px; }

.stepper { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stepper__step {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--r-md);
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
  border-radius: var(--r-md); border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; cursor: pointer;
  transition: border-color 160ms var(--app-ease), background 160ms var(--app-ease);
}
.mode__opt--on { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.08); }
.mode__opt:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
[dir='rtl'] .flip-icon :deep(.v-icon) { transform: scaleX(-1); }
</style>
