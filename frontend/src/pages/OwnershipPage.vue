<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';

interface OwnershipRow {
  id: string;
  processKey: string;
  status: string;
  roles: string[];
}

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];

const { t } = useI18n();
const rows = ref<OwnershipRow[]>([]);
const loaded = ref(false);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  rows.value = await api.get<OwnershipRow[]>('/api/settings/ownership');
  loaded.value = true;
}

async function update(row: OwnershipRow, roles: string[]) {
  if (roles.length === 0) {
    notify(t('ownership.atLeastOne'), 'error');
    await load();
    return;
  }
  busy.value = row.id;
  try {
    await api.put(`/api/settings/ownership/${row.id}`, { roles });
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
    await load();
  }
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1000px">
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('ownership.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('ownership.subtitle') }}</p>

    <v-card v-if="loaded">
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('ownership.machine') }}</th>
            <th>{{ $t('trainees.status') }}</th>
            <th style="width: 340px">{{ $t('ownership.groups') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="font-weight-medium">{{ $t(`entities.${row.processKey}`, row.processKey) }}</td>
            <td>
              {{ $t(`status.${row.status}`, $t(`offboardingStatus.${row.status}`, $t(`processStatus.${row.status}`, $t(`assetStatus.${row.status}`, row.status)))) }}
            </td>
            <td>
              <v-select
                :model-value="row.roles"
                :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
                multiple
                chips
                closable-chips
                density="compact"
                hide-details
                variant="plain"
                :disabled="busy === row.id"
                @update:model-value="(roles: string[]) => update(row, roles)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text class="text-caption text-medium-emphasis">
        {{ $t('ownership.hint') }}
      </v-card-text>
    </v-card>

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
