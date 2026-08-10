<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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

const PIPELINE = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
];

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const employees = ref<EmployeeRow[]>([]);
const loading = ref(true);
const dialog = ref(false);
const saving = ref(false);
const error = ref('');
const filter = ref<'all' | 'onboarding' | 'active' | 'inactive'>('all');

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

async function load() {
  loading.value = true;
  [employees.value, options.value] = await Promise.all([
    api.get<EmployeeRow[]>('/api/employees'),
    api.get<{ departments: string[]; jobTitles: string[] }>('/api/employees/options'),
  ]);
  loading.value = false;
}

const filtered = computed(() => {
  if (filter.value === 'all') return employees.value;
  if (filter.value === 'active') return employees.value.filter((e) => e.status === 'ACTIVE');
  if (filter.value === 'inactive') return employees.value.filter((e) => e.status === 'INACTIVE');
  return employees.value.filter((e) => PIPELINE.includes(e.status));
});

const counts = computed(() => ({
  all: employees.value.length,
  onboarding: employees.value.filter((e) => PIPELINE.includes(e.status)).length,
  active: employees.value.filter((e) => e.status === 'ACTIVE').length,
  inactive: employees.value.filter((e) => e.status === 'INACTIVE').length,
}));

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
]);

onMounted(load);
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
      <v-data-table :headers="headers" :items="filtered" :loading="loading" hover @click:row="openRow">
        <template #item.employeeNo="{ item }">
          <span class="font-weight-bold">{{ item.employeeNo ?? '—' }}</span>
        </template>
        <template #item.name="{ item }">
          {{ item.firstName }} {{ item.lastName }}
        </template>
        <template #item.status="{ item }">
          <StatusChip :status="item.status" />
        </template>
        <template #no-data>
          <div class="pa-8 text-medium-emphasis">{{ $t('employees.empty') }}</div>
        </template>
      </v-data-table>
    </v-card>

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
  </v-container>
</template>
