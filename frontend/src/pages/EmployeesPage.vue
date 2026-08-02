<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api } from '../api/client';

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
const employees = ref<EmployeeRow[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  employees.value = await api.get<EmployeeRow[]>('/api/employees');
  loading.value = false;
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
  </v-container>
</template>
