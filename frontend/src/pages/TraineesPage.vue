<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api/client';
import StatusChip from '../components/StatusChip.vue';

interface TraineeRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string | null;
  jobTitle: string | null;
  status: string;
  createdAt: string;
}

const { t } = useI18n();
const router = useRouter();

const trainees = ref<TraineeRow[]>([]);
const loading = ref(true);
const dialog = ref(false);
const saving = ref(false);
const error = ref('');

const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  department: '',
  jobTitle: '',
});

const DEFAULT_DOCS = ['NATIONAL_ID', 'QUALIFICATION', 'PHOTO', 'IBAN_LETTER'];

async function load() {
  loading.value = true;
  trainees.value = await api.get<TraineeRow[]>('/api/trainees');
  loading.value = false;
}

async function createTrainee() {
  saving.value = true;
  error.value = '';
  try {
    const body: Record<string, unknown> = { documentTypes: DEFAULT_DOCS };
    for (const [k, v] of Object.entries(form.value)) if (v.trim()) body[k] = v.trim();
    const created = await api.post<TraineeRow>('/api/trainees', body);
    dialog.value = false;
    await router.push(`/trainees/${created.id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
  } finally {
    saving.value = false;
  }
}

function openRow(_e: unknown, row: { item: TraineeRow }) {
  void router.push(`/trainees/${row.item.id}`);
}

const headers = [
  { title: t('trainees.name'), key: 'name', sortable: false },
  { title: t('trainees.email'), key: 'email' },
  { title: t('trainees.department'), key: 'department' },
  { title: t('trainees.jobTitle'), key: 'jobTitle' },
  { title: t('trainees.status'), key: 'status' },
];

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('trainees.title') }}</h1>
        <p class="text-medium-emphasis mt-1">{{ $t('trainees.subtitle') }}</p>
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="dialog = true">
        {{ $t('trainees.new') }}
      </v-btn>
    </div>

    <v-card>
      <v-data-table
        :headers="headers"
        :items="trainees"
        :loading="loading"
        hover
        @click:row="openRow"
      >
        <template #item.name="{ item }">
          <span class="font-weight-medium">{{ item.firstName }} {{ item.lastName }}</span>
        </template>
        <template #item.status="{ item }">
          <StatusChip :status="item.status" />
        </template>
        <template #no-data>
          <div class="pa-8 text-medium-emphasis">{{ $t('trainees.empty') }}</div>
        </template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="560">
      <v-card :title="$t('trainees.new')" class="pa-2">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
          <v-row dense>
            <v-col cols="6">
              <v-text-field v-model="form.firstName" :label="$t('trainees.firstName')" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="form.lastName" :label="$t('trainees.lastName')" />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="form.email" :label="$t('trainees.email')" type="email" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="form.phone" :label="$t('trainees.phone')" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="form.department" :label="$t('trainees.department')" />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="form.jobTitle" :label="$t('trainees.jobTitle')" />
            </v-col>
          </v-row>
          <p class="text-caption text-medium-emphasis mt-2">{{ $t('trainees.docsHint') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="!form.firstName || !form.lastName || !form.email"
            @click="createTrainee"
          >
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
