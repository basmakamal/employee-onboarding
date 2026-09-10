<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  /** Still on a temporary password (invited or admin-reset), not yet replaced. */
  mustChangePassword: boolean;
  invitedAt: string | null;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
}

/** Resend is only meaningful while the person has never set their own password. */
function canResend(user: UserRow): boolean {
  return user.active && user.mustChangePassword && !user.passwordChangedAt;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];

const { t } = useI18n();
const auth = useAuthStore();
const users = ref<UserRow[]>([]);
const loading = ref(true);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

const createDialog = ref(false);
const createForm = ref({ name: '', email: '', role: 'HR', password: '', sendInvitation: true });
/** Shown once when no invitation was sent and the password was generated. */
const tempDialog = ref({ show: false, name: '', password: '' });

const resetDialog = ref({ show: false, userId: '', name: '', password: '' });

const editDialog = ref({ show: false, userId: '', name: '', email: '', role: 'HR', active: true });

/** Admins cannot demote or lock themselves out — enforced server-side too. */
const isSelf = computed(() => editDialog.value.userId === auth.user?.id);

function openEdit(user: UserRow) {
  editDialog.value = { show: true, userId: user.id, ...user, email: user.email };
}

async function saveEdit() {
  busy.value = 'edit';
  try {
    const d = editDialog.value;
    const changes: Record<string, unknown> = { name: d.name.trim(), email: d.email.trim() };
    // Own row: role/active are locked server-side (SELF_LOCKOUT) — don't send them.
    if (d.userId !== auth.user?.id) {
      changes['role'] = d.role;
      changes['active'] = d.active;
    }
    await api.put(`/api/users/${d.userId}`, changes);
    editDialog.value.show = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function load() {
  loading.value = true;
  // Staff accounts stay a small set — one capped page is the whole list.
  const data = await api.get<{ items: UserRow[]; total: number }>('/api/users?limit=100');
  users.value = data.items;
  loading.value = false;
}

async function createUser() {
  busy.value = 'create';
  try {
    const f = createForm.value;
    const created = await api.post<UserRow & { tempPassword?: string }>('/api/users', {
      name: f.name.trim(),
      email: f.email.trim(),
      role: f.role,
      sendInvitation: f.sendInvitation,
      ...(f.password ? { password: f.password } : {}),
    });
    createDialog.value = false;
    createForm.value = { name: '', email: '', role: 'HR', password: '', sendInvitation: true };
    if (created.tempPassword) {
      tempDialog.value = { show: true, name: created.name, password: created.tempPassword };
    } else {
      notify(f.sendInvitation ? t('users.invitationSent', { email: created.email }) : t('common.saved'));
    }
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function resendInvitation(user: UserRow) {
  if (!window.confirm(t('users.resendConfirm', { name: user.name }))) return;
  busy.value = user.id;
  try {
    await api.post(`/api/users/${user.id}/invite`);
    notify(t('users.invitationSent', { email: user.email }));
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
        <template #item.name="{ item }">
          <div class="font-weight-medium">{{ item.name }}</div>
          <div class="text-caption text-medium-emphasis">
            <v-chip
              v-if="canResend(item)"
              size="x-small"
              color="warning"
              variant="tonal"
              prepend-icon="mdi-email-fast-outline"
              class="me-1"
            >
              {{ item.invitedAt ? $t('users.invitedChip') : $t('users.resetChip') }}
            </v-chip>
            <span v-if="item.lastLoginAt">{{ $t('users.lastLogin', { when: when(item.lastLoginAt) }) }}</span>
            <span v-else-if="!canResend(item)">{{ $t('users.neverSignedIn') }}</span>
          </div>
        </template>
        <template #item.role="{ item }">
          <!-- Your own row: read-only — you cannot demote or deactivate yourself. -->
          <template v-if="item.id === auth.user?.id">
            <span>{{ $t(`roles.${item.role}`) }}</span>
            <v-chip size="x-small" color="primary" variant="tonal" class="ms-2 font-weight-bold">
              {{ $t('users.you') }}
            </v-chip>
          </template>
          <v-select
            v-else
            :model-value="item.role"
            :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
            density="compact"
            hide-details
            variant="plain"
            style="max-width: 200px"
            :disabled="busy === item.id"
            @update:model-value="(role: string) => updateUser(item, { role })"
          />
        </template>
        <template #item.active="{ item }">
          <v-tooltip v-if="item.id === auth.user?.id" location="top" :text="$t('users.selfHint')">
            <template #activator="{ props }">
              <v-chip
                v-bind="props"
                :color="item.active ? 'success' : 'error'"
                size="small"
                variant="tonal"
                prepend-icon="mdi-lock"
              >
                {{ $t(`employees.statuses.${item.active ? 'ACTIVE' : 'INACTIVE'}`) }}
              </v-chip>
            </template>
          </v-tooltip>
          <v-switch
            v-else
            :model-value="item.active"
            color="success"
            density="compact"
            hide-details
            :disabled="busy === item.id"
            @update:model-value="(active: unknown) => updateUser(item, { active: Boolean(active) })"
          />
        </template>
        <template #item.actions="{ item }">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-pencil"
            class="me-2"
            @click="openEdit(item)"
          >
            {{ $t('common.edit') }}
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-lock-reset"
            class="me-2"
            @click="resetDialog = { show: true, userId: item.id, name: item.name, password: '' }"
          >
            {{ $t('users.resetPassword') }}
          </v-btn>
          <v-btn
            v-if="canResend(item)"
            size="small"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-email-fast-outline"
            :loading="busy === item.id"
            @click="resendInvitation(item)"
          >
            {{ $t('users.resendInvitation') }}
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
            :label="$t('users.tempPassword')"
            type="password"
            :hint="createForm.password ? $t('users.passwordHint') : $t('users.tempPasswordOptional')"
            persistent-hint
            dir="ltr"
          />

          <div class="access-panel mt-4 px-4 py-3 rounded-lg">
            <v-switch v-model="createForm.sendInvitation" color="primary" hide-details density="comfortable">
              <template #label>
                <div class="ms-2">
                  <div class="text-body-2 font-weight-medium">{{ $t('users.sendInvitation') }}</div>
                  <div class="text-caption text-medium-emphasis">{{ $t('users.sendInvitationHint') }}</div>
                </div>
              </template>
            </v-switch>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="createDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            variant="flat"
            color="primary"
            class="px-5"
            :loading="busy === 'create'"
            :disabled="
              !createForm.name || !createForm.email || (createForm.password.length > 0 && createForm.password.length < 8)
            "
            @click="createUser"
          >
            {{ createForm.sendInvitation ? $t('users.sendInvitation') : $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Generated temporary password: shown exactly once -->
    <v-dialog v-model="tempDialog.show" max-width="440" persistent>
      <v-card>
        <div class="px-6 pt-6 pb-2">
          <h2 class="text-subtitle-1 font-weight-bold">{{ $t('users.tempPasswordTitle') }}</h2>
          <p class="text-caption text-medium-emphasis mb-0">
            {{ $t('users.tempPasswordShown', { name: tempDialog.name }) }}
          </p>
        </div>
        <v-card-text class="pt-4">
          <v-text-field :model-value="tempDialog.password" readonly dir="ltr" class="font-weight-bold" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5 pt-0">
          <v-spacer />
          <v-btn variant="flat" color="primary" class="px-5" @click="tempDialog.show = false">
            {{ $t('common.done') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit user -->
    <v-dialog v-model="editDialog.show" max-width="520">
      <v-card>
        <div class="d-flex align-center ga-3 px-6 pt-6 pb-2">
          <v-avatar color="primary" variant="tonal" size="42" rounded="lg">
            <v-icon icon="mdi-account-edit-outline" size="22" />
          </v-avatar>
          <div class="min-w-0">
            <h2 class="text-subtitle-1 font-weight-bold">{{ $t('users.editTitle') }}</h2>
            <p class="text-caption text-medium-emphasis mb-0 text-truncate">
              {{ editDialog.email }}
            </p>
          </div>
        </div>

        <v-card-text class="pt-4">
          <v-text-field
            v-model="editDialog.name"
            :label="$t('fields.name')"
            prepend-inner-icon="mdi-account-outline"
            class="mb-1"
          />
          <v-text-field
            v-model="editDialog.email"
            :label="$t('fields.email')"
            type="email"
            prepend-inner-icon="mdi-email-outline"
            dir="ltr"
            class="mb-1"
          />
          <v-select
            v-model="editDialog.role"
            :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
            :label="$t('users.role')"
            prepend-inner-icon="mdi-shield-account-outline"
            :disabled="isSelf"
          />

          <!-- Access sits in its own panel: it is a different kind of decision
               from a name or an email, and it deserves the visual pause. -->
          <div class="access-panel mt-2 px-4 py-3 rounded-lg">
            <v-switch
              v-model="editDialog.active"
              color="success"
              :disabled="isSelf"
              hide-details
              density="comfortable"
            >
              <template #label>
                <div class="ms-2">
                  <div class="text-body-2 font-weight-medium">{{ $t('users.active') }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ editDialog.active ? $t('users.activeHint') : $t('users.inactiveHint') }}
                  </div>
                </div>
              </template>
            </v-switch>
          </div>

          <v-alert
            v-if="isSelf"
            type="info"
            density="compact"
            class="mt-4 text-caption"
          >
            {{ $t('users.selfHint') }}
          </v-alert>
        </v-card-text>

        <v-card-actions class="px-6 pb-5 pt-2">
          <v-spacer />
          <v-btn variant="text" @click="editDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            variant="flat"
            color="primary"
            class="px-5"
            :loading="busy === 'edit'"
            :disabled="!editDialog.name.trim() || !editDialog.email.trim()"
            @click="saveEdit"
          >
            {{ $t('common.save') }}
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
            variant="flat"
            color="primary"
            class="px-5"
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

<style scoped>
.access-panel {
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
