<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];

const { t } = useI18n();
const auth = useAuthStore();
const users = ref<UserRow[]>([]);
const loading = ref(true);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

const createDialog = ref(false);
const createForm = ref({ name: '', email: '', role: 'HR', password: '' });

const resetDialog = ref({ show: false, userId: '', name: '', password: '' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  loading.value = true;
  users.value = await api.get<UserRow[]>('/api/users');
  loading.value = false;
}

async function createUser() {
  busy.value = 'create';
  try {
    await api.post('/api/users', { ...createForm.value, email: createForm.value.email.trim() });
    createDialog.value = false;
    createForm.value = { name: '', email: '', role: 'HR', password: '' };
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function updateUser(user: UserRow, changes: Partial<UserRow>) {
  busy.value = user.id;
  try {
    await api.put(`/api/users/${user.id}`, changes);
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
    await load();
  }
}

async function resetPassword() {
  busy.value = 'reset';
  try {
    await api.post(`/api/users/${resetDialog.value.userId}/reset-password`, {
      password: resetDialog.value.password,
    });
    resetDialog.value = { show: false, userId: '', name: '', password: '' };
    notify(t('users.passwordReset'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

const headers = [
  { title: t('fields.name'), key: 'name' },
  { title: t('fields.email'), key: 'email' },
  { title: t('users.role'), key: 'role' },
  { title: t('users.active'), key: 'active' },
  { title: '', key: 'actions', sortable: false },
];

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <div class="d-flex align-center mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('users.title') }}</h1>
        <p class="text-medium-emphasis mt-1">{{ $t('users.subtitle') }}</p>
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-account-plus" @click="createDialog = true">
        {{ $t('users.new') }}
      </v-btn>
    </div>

    <v-card>
      <v-data-table :headers="headers" :items="users" :loading="loading">
        <template #item.role="{ item }">
          <v-select
            :model-value="item.role"
            :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
            density="compact"
            hide-details
            variant="plain"
            style="max-width: 200px"
            :disabled="item.id === auth.user?.id || busy === item.id"
            @update:model-value="(role: string) => updateUser(item, { role })"
          />
        </template>
        <template #item.active="{ item }">
          <v-switch
            :model-value="item.active"
            color="success"
            density="compact"
            hide-details
            :disabled="item.id === auth.user?.id || busy === item.id"
            @update:model-value="(active: unknown) => updateUser(item, { active: Boolean(active) })"
          />
        </template>
        <template #item.actions="{ item }">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-lock-reset"
            @click="resetDialog = { show: true, userId: item.id, name: item.name, password: '' }"
          >
            {{ $t('users.resetPassword') }}
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create user -->
    <v-dialog v-model="createDialog" max-width="520">
      <v-card :title="$t('users.new')" class="pa-2">
        <v-card-text>
          <v-text-field v-model="createForm.name" :label="$t('fields.name')" />
          <v-text-field v-model="createForm.email" :label="$t('fields.email')" type="email" />
          <v-select
            v-model="createForm.role"
            :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
            :label="$t('users.role')"
          />
          <v-text-field
            v-model="createForm.password"
            :label="$t('login.password')"
            type="password"
            :hint="$t('users.passwordHint')"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="createDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="busy === 'create'"
            :disabled="!createForm.name || !createForm.email || createForm.password.length < 8"
            @click="createUser"
          >
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Reset password -->
    <v-dialog v-model="resetDialog.show" max-width="440">
      <v-card :title="`${$t('users.resetPassword')} — ${resetDialog.name}`" class="pa-2">
        <v-card-text>
          <v-text-field
            v-model="resetDialog.password"
            :label="$t('users.newPassword')"
            type="password"
            :hint="$t('users.passwordHint')"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="busy === 'reset'"
            :disabled="resetDialog.password.length < 8"
            @click="resetPassword"
          >
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
