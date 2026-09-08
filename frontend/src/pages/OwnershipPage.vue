<script setup lang="ts">
/**
 * Two admin controls that are easy to confuse, kept side by side on purpose:
 *   - Status ownership: which role GROUPS may act on each status (permission).
 *   - Primary owners: which PEOPLE receive the reminders per process
 *     (notification only — never a restriction on who may act).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';

interface OwnershipRow {
  id: string;
  processKey: string;
  status: string;
  roles: string[];
}

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];
const RESPONSIBILITY_KEYS = [
  'EMPLOYEE',
  'GOSI',
  'MEDICAL_INSURANCE',
  'CRIMINAL_RECORD',
  'ASSET_FORM',
  'OFFBOARDING',
] as const;

const { t } = useI18n();
const rows = ref<OwnershipRow[]>([]);
const responsibility = ref<Record<string, string[]>>({});
const staff = ref<StaffUser[]>([]);
const loaded = ref(false);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

const staffItems = computed(() =>
  staff.value
    .filter((u) => u.active)
    .map((u) => ({ title: u.name, value: u.id, props: { subtitle: `${u.email} · ${t(`roles.${u.role}`)}` } })),
);

async function load() {
  const [ownership, owners, users] = await Promise.all([
    api.get<OwnershipRow[]>('/api/settings/ownership'),
    api.get<Record<string, string[]>>('/api/settings/responsibility'),
    api.get<{ items: StaffUser[] }>('/api/users?page=1&limit=100'),
  ]);
  rows.value = ownership;
  responsibility.value = owners;
  staff.value = users.items;
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

async function updateOwners(processKey: string, userIds: string[]) {
  busy.value = `owners:${processKey}`;
  try {
    responsibility.value = await api.put(`/api/settings/responsibility/${processKey}`, { userIds });
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
    await load();
  } finally {
    busy.value = '';
  }
}

function processLabel(key: string): string {
  return key === 'EMPLOYEE' ? t('responsibility.EMPLOYEE') : t(`entities.${key}`, key);
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1000px">
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('ownership.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('ownership.subtitle') }}</p>

    <template v-if="loaded">
      <!-- Who is RESPONSIBLE (gets the reminders) -->
      <v-card class="mb-6">
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="mdi-account-star-outline" class="me-2" color="primary" />
            {{ $t('responsibility.title') }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ $t('responsibility.subtitle') }}</v-card-subtitle>
        </v-card-item>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('responsibility.process') }}</th>
              <th style="width: 460px">{{ $t('responsibility.owners') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in RESPONSIBILITY_KEYS" :key="key">
              <td class="font-weight-medium">{{ processLabel(key) }}</td>
              <td>
                <v-select
                  :model-value="responsibility[key] ?? []"
                  :items="staffItems"
                  :placeholder="$t('responsibility.none')"
                  multiple
                  chips
                  closable-chips
                  density="compact"
                  hide-details
                  variant="plain"
                  :disabled="busy === `owners:${key}`"
                  @update:model-value="(ids: string[]) => updateOwners(key, ids)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text class="text-caption text-medium-emphasis">
          {{ $t('responsibility.hint') }}
        </v-card-text>
      </v-card>

      <!-- Who MAY ACT (permission) -->
      <v-card>
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="mdi-shield-account-outline" class="me-2" color="primary" />
            {{ $t('ownership.groups') }}
          </v-card-title>
        </v-card-item>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('ownership.machine') }}</th>
              <th>{{ $t('fields.status') }}</th>
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
    </template>

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
