<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface EmployeeRow {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const employees = ref<EmployeeRow[]>([]);
const loading = ref(true);
const dialog = ref(false);
const saving = ref(false);
const error = ref('');

const form = ref({
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

async function load() {
  loading.value = true;
  employees.value = await api.get<EmployeeRow[]>('/api/employees');
  loading.value = false;
}

async function createEmployee() {
  saving.value = true;
  error.value = '';
  try {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form.value)) if (v.trim()) body[k] = v.trim();
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

const headers = [
  { title: t('employees.no'), key: 'employeeNo' },
  { title: t('trainees.name'), key: 'name', sortable: false },
  { title: t('trainees.email'), key: 'email' },
  { title: t('trainees.department'), key: 'department' },
  { title: t('trainees.status'), key: 'status' },
];

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

    <v-card>
      <v-data-table :headers="headers" :items="employees" :loading="loading" hover @click:row="openRow">
        <template #item.employeeNo="{ item }">
          <span class="font-weight-bold">{{ item.employeeNo }}</span>
        </template>
        <template #item.name="{ item }">
          {{ item.firstName }} {{ item.lastName }}
        </template>
        <template #item.status="{ item }">
          <v-chip
            :color="item.status === 'ACTIVE' ? 'success' : 'grey'"
            size="small"
            variant="tonal"
          >
            {{ $t(`employees.statuses.${item.status}`) }}
          </v-chip>
        </template>
        <template #no-data>
          <div class="pa-8 text-medium-emphasis">{{ $t('employees.empty') }}</div>
        </template>
      </v-data-table>
    </v-card>

    <!-- Direct add: existing staff who never went through the trainee flow -->
    <v-dialog v-model="dialog" max-width="620">
      <v-card :title="$t('employees.new')" class="pa-2">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
          <v-alert type="info" variant="tonal" density="compact" class="mb-4">
            {{ $t('employees.directHint') }}
          </v-alert>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="form.firstName" :label="$t('trainees.firstName')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.lastName" :label="$t('trainees.lastName')" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.email" :label="$t('trainees.email')" type="email" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.phone" :label="$t('trainees.phone')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.nationalId" :label="$t('trainees.nationalId')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.department" :label="$t('trainees.department')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.project" :label="$t('employees.project')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.jobTitle" :label="$t('trainees.jobTitle')" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.hireDate" :label="$t('employees.hireDate')" type="date" /></v-col>
          </v-row>
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
