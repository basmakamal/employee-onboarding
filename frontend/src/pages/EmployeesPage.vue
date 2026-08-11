<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/client';
import StatusChip from '../components/StatusChip.vue';
import { useAuthStore } from '../stores/auth';

interface EmployeeRow {
  id: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  status: string;
}

/** Server response: one page + the tab badge counts. */
interface EmployeePage {
  items: EmployeeRow[];
  total: number;
  counts: { all: number; onboarding: number; active: number; inactive: number };
}

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const employees = ref<EmployeeRow[]>([]);
const total = ref(0);
const counts = ref<EmployeePage['counts']>({ all: 0, onboarding: 0, active: 0, inactive: 0 });
const loading = ref(true);
const dialog = ref(false);
const saving = ref(false);
const error = ref('');
const filter = ref<'all' | 'onboarding' | 'active' | 'inactive'>('all');
const search = ref('');

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
};

const form = ref({
  mode: 'onboarding' as 'onboarding' | 'direct',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  nationalId: '',
  department: '',
  project: '',
  jobTitle: '',
  hireDate: '',
});
const sendFormNow = ref(true);

/** Known departments / job titles — new typed values join the list on save. */
const options = ref<{ departments: string[]; jobTitles: string[] }>({
  departments: [],
  jobTitles: [],
});

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
  }
}

/** The table drives page/size/sort; one handler reloads from the server. */
function onTableOptions(options: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = options.page;
  itemsPerPage.value = options.itemsPerPage;
  sortBy.value = options.sortBy;
  void load();
}

// Filter chips and typing in search restart from page 1. Search debounces so
// the server sees one query per pause, not one per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(filter, () => {
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

async function loadOptions() {
  options.value = await api.get<{ departments: string[]; jobTitles: string[] }>(
    '/api/employees/options',
  );
}

async function createEmployee() {
  saving.value = true;
  error.value = '';
  try {
    const body: Record<string, unknown> = { direct: form.value.mode === 'direct' };
    for (const [k, v] of Object.entries(form.value)) {
      // comboboxes emit null when cleared — only keep real text
      if (k !== 'mode' && typeof v === 'string' && v.trim()) body[k] = v.trim();
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

function openRow(_e: unknown, row: { item: EmployeeRow }) {
  void router.push(`/employees/${row.item.id}`);
}

const headers = computed(() => [
  { title: t('employees.no'), key: 'employeeNo' },
  { title: t('fields.name'), key: 'name', sortable: false },
  { title: t('fields.email'), key: 'email' },
  { title: t('fields.department'), key: 'department' },
  { title: t('fields.status'), key: 'status' },
  ...(auth.user?.role === 'ADMIN' ? [{ title: '', key: 'actions', sortable: false }] : []),
]);

// ------------------------------------------------------------- hard delete (ADMIN)
const deleteDialog = ref({ show: false, employee: null as EmployeeRow | null });
const deleting = ref(false);

async function removeEmployee() {
  const target = deleteDialog.value.employee;
  if (!target) return;
  deleting.value = true;
  try {
    await api.delete(`/api/employees/${target.id}`);
    deleteDialog.value = { show: false, employee: null };
    await load();
  } catch (e) {
    snackbar.value = {
      show: true,
      text: e instanceof ApiError ? e.message : t('common.error'),
    };
    deleteDialog.value.show = false;
  } finally {
    deleting.value = false;
  }
}

const snackbar = ref({ show: false, text: '' });

// The table's initial @update:options fires load(); options load in parallel.
onMounted(loadOptions);
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('employees.title') }}</h1>
        <p class="text-medium-emphasis mt-1">{{ $t('employees.subtitle') }}</p>
      </div>
      <v-spacer />
      <v-btn v-if="auth.hasRole('HR')" color="primary" prepend-icon="mdi-plus" @click="dialog = true">
        {{ $t('employees.new') }}
      </v-btn>
    </div>

    <!-- Lifecycle filter -->
    <v-chip-group v-model="filter" mandatory class="mb-3" selected-class="text-primary">
      <v-chip
        v-for="key in ['all', 'onboarding', 'active', 'inactive'] as const"
        :key="key"
        :value="key"
        variant="tonal"
        filter
      >
        {{ $t(`employees.filters.${key}`) }} ({{ counts[key] }})
      </v-chip>
    </v-chip-group>

    <v-card>
      <v-text-field
        v-model="search"
        :placeholder="$t('employees.searchPlaceholder')"
        prepend-inner-icon="mdi-magnify"
        variant="solo"
        flat
        hide-details
        clearable
        class="px-2 pt-2"
      />
      <v-data-table-server
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="headers"
        :items="employees"
        :items-length="total"
        :loading="loading"
        hover
        @click:row="openRow"
        @update:options="onTableOptions"
      >
        <template #item.employeeNo="{ item }">
          <span class="font-weight-bold">{{ item.employeeNo ?? '—' }}</span>
        </template>
        <template #item.name="{ item }">
          {{ item.firstName }} {{ item.lastName }}
        </template>
        <template #item.status="{ item }">
          <StatusChip :status="item.status" />
        </template>
        <template #item.actions="{ item }">
          <v-tooltip location="top" :text="$t('profile.delete')">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-forever-outline"
                variant="text"
                size="small"
                color="error"
                @click.stop="deleteDialog = { show: true, employee: item }"
              />
            </template>
          </v-tooltip>
        </template>
        <template #no-data>
          <div class="pa-8 text-medium-emphasis">{{ $t('employees.empty') }}</div>
        </template>
      </v-data-table-server>
    </v-card>

    <!-- Hard delete confirmation (ADMIN) -->
    <v-dialog v-model="deleteDialog.show" max-width="480">
      <v-card :title="$t('profile.delete')" class="pa-2">
        <v-card-text>
          <v-alert type="error" variant="tonal" class="mb-3">
            {{ $t('profile.deleteWarning') }}
          </v-alert>
          <p class="text-body-2">
            <strong>
              {{ deleteDialog.employee?.firstName }} {{ deleteDialog.employee?.lastName }}
            </strong>
            <template v-if="deleteDialog.employee?.employeeNo">
              · {{ deleteDialog.employee?.employeeNo }}
            </template>
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="removeEmployee">
            {{ $t('profile.deleteConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- New employee: onboarding pipeline (default) or direct add -->
    <v-dialog v-model="dialog" max-width="620">
      <v-card :title="$t('employees.new')" class="pa-2">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

          <v-btn-toggle v-model="form.mode" mandatory color="primary" class="mb-4" divided>
            <v-btn value="onboarding" prepend-icon="mdi-school">
              {{ $t('onboarding.newHire') }}
            </v-btn>
            <v-btn value="direct" prepend-icon="mdi-badge-account">
              {{ $t('onboarding.existing') }}
            </v-btn>
          </v-btn-toggle>

          <v-alert type="info" variant="tonal" density="compact" class="mb-4">
            {{ form.mode === 'onboarding' ? $t('onboarding.newHireHint') : $t('employees.directHint') }}
          </v-alert>

          <v-row dense>
            <v-col cols="6"><v-text-field v-model="form.firstName" :label="$t('fields.firstName')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.lastName" :label="$t('fields.lastName')" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.email" :label="$t('fields.email')" type="email" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.phone" :label="$t('fields.phone')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.nationalId" :label="$t('fields.nationalId')" /></v-col>
            <v-col cols="6">
              <v-combobox
                v-model="form.department"
                :items="options.departments"
                :label="$t('fields.department')"
                :hint="$t('fields.comboHint')"
                persistent-hint
              />
            </v-col>
            <v-col cols="6"><v-text-field v-model="form.project" :label="$t('employees.project')" /></v-col>
            <v-col cols="6">
              <v-combobox
                v-model="form.jobTitle"
                :items="options.jobTitles"
                :label="$t('fields.jobTitle')"
                :hint="$t('fields.comboHint')"
                persistent-hint
              />
            </v-col>
            <v-col v-if="form.mode === 'direct'" cols="6">
              <v-text-field v-model="form.hireDate" :label="$t('employees.hireDate')" type="date" />
            </v-col>
          </v-row>
          <template v-if="form.mode === 'onboarding'">
            <v-checkbox
              v-model="sendFormNow"
              :label="$t('onboarding.sendNow')"
              density="compact"
              hide-details
              class="mt-1"
            />
            <p class="text-caption text-medium-emphasis mb-0">
              {{ $t('onboarding.docsHint') }}
            </p>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="!form.firstName || !form.lastName || !form.email"
            @click="createEmployee"
          >
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" color="error" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
