<script setup lang="ts">
/**
 * The employee's own sign-in ("My space"), managed by HR from the file:
 * create it (invitation e-mail, or a temporary password shown once),
 * reset the password, switch it off and on. The login only opens while the
 * employee is active — it can be prepared before the first working day.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';

interface Account {
  id: string;
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  invitedAt: string | null;
  lastLoginAt: string | null;
}

const props = defineProps<{ employeeId: string; employeeStatus: string; employeeEmail: string; canEdit: boolean }>();
const { t, locale } = useI18n();
const confirm = useConfirm();

const account = ref<Account | null>(null);
const loaded = ref(false);
const error = ref('');
const busy = ref('');

async function load() {
  try {
    account.value = (await api.get<{ account: Account | null }>(`/api/employees/${props.employeeId}/account`)).account;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
}
onMounted(load);

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale.value.startsWith('ar') ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// ─────────────────────────────────────────────── create
const createDialog = ref(false);
const draft = ref({ email: '', sendInvitation: true });
const form = useForm();
function openCreate() {
  draft.value = { email: props.employeeEmail, sendInvitation: true };
  form.reset();
  createDialog.value = true;
}
function create() {
  return form.submit(async () => {
    const res = await api.post<{ account: Account; tempPassword?: string }>(`/api/employees/${props.employeeId}/account`, {
      email: draft.value.email.trim(),
      sendInvitation: draft.value.sendInvitation,
    });
    account.value = res.account;
    createDialog.value = false;
    if (res.tempPassword) shown.value = { show: true, password: res.tempPassword };
  });
}

/** A temporary password nobody else will see — shown exactly once. */
const shown = ref({ show: false, password: '' });

async function reset(sendInvitation: boolean) {
  const ok = await confirm({
    title: t('account.employee.reset'),
    message: sendInvitation ? t('account.employee.resetMail', { email: account.value?.email ?? '' }) : t('account.employee.resetShow'),
    confirmText: t('account.employee.reset'),
  });
  if (!ok) return;
  busy.value = 'reset';
  error.value = '';
  try {
    const res = await api.post<{ account: Account; tempPassword?: string }>(`/api/employees/${props.employeeId}/account/reset-password`, { sendInvitation });
    account.value = res.account;
    if (res.tempPassword) shown.value = { show: true, password: res.tempPassword };
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = '';
  }
}

async function toggle() {
  if (!account.value) return;
  const next = !account.value.active;
  if (!next) {
    const ok = await confirm({ title: t('account.employee.disable'), message: t('account.employee.disableConfirm'), color: 'error', confirmText: t('account.employee.disable') });
    if (!ok) return;
  }
  busy.value = 'toggle';
  error.value = '';
  try {
    account.value = (await api.put<{ account: Account }>(`/api/employees/${props.employeeId}/account`, { active: next })).account;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <v-card class="mb-4">
    <v-card-item>
      <v-card-title class="text-subtitle-1 font-weight-bold">
        <v-icon icon="fluent:person-key" class="me-2" />
        {{ $t('account.employee.title') }}
      </v-card-title>
    </v-card-item>
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
      <template v-if="loaded">
        <template v-if="!account">
          <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('account.employee.none') }}</p>
          <v-btn v-if="canEdit" color="primary" variant="tonal" prepend-icon="user-plus" @click="openCreate">
            {{ $t('account.employee.create') }}
          </v-btn>
        </template>
        <template v-else>
          <div class="d-flex align-center ga-2 mb-1">
            <span class="text-body-2 font-weight-medium" dir="ltr">{{ account.email }}</span>
            <v-chip size="x-small" variant="tonal" :color="account.active ? 'success' : 'grey'">
              {{ account.active ? $t('account.employee.on') : $t('account.employee.off') }}
            </v-chip>
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ $t('account.employee.lastLogin', { date: fmt(account.lastLoginAt) }) }}
            <template v-if="account.mustChangePassword"> · {{ $t('account.employee.tempPassword') }}</template>
          </div>
          <div v-if="canEdit" class="d-flex flex-wrap ga-2 mt-3">
            <v-btn size="small" variant="tonal" prepend-icon="mail" :loading="busy === 'reset'" @click="reset(true)">{{ $t('account.employee.resetByMail') }}</v-btn>
            <v-btn size="small" variant="text" prepend-icon="key-round" :loading="busy === 'reset'" @click="reset(false)">{{ $t('account.employee.resetShowBtn') }}</v-btn>
            <v-btn size="small" variant="text" :color="account.active ? 'error' : 'success'" :loading="busy === 'toggle'" @click="toggle">
              {{ account.active ? $t('account.employee.disable') : $t('account.employee.enable') }}
            </v-btn>
          </div>
        </template>
        <v-alert v-if="employeeStatus !== 'ACTIVE'" type="info" variant="tonal" density="compact" class="mt-3 text-caption">
          {{ $t('account.employee.opensWhenActive') }}
        </v-alert>
      </template>
    </v-card-text>
  </v-card>

  <v-dialog v-model="createDialog" max-width="480">
    <v-card :title="$t('account.employee.create')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="form" />
        <v-form :ref="form.bind" @submit.prevent="create">
          <v-text-field
            v-model="draft.email"
            :label="$t('account.employee.loginEmail') + ' *'"
            type="email"
            dir="ltr"
            :rules="[rules.required, rules.email]"
            :error-messages="form.errorsFor('email')"
          />
          <v-switch v-model="draft.sendInvitation" color="primary" hide-details density="comfortable">
            <template #label>
              <div class="ms-2">
                <div class="text-body-2 font-weight-medium">{{ $t('users.sendInvitation') }}</div>
                <div class="text-caption text-medium-emphasis">{{ $t('account.employee.inviteHint') }}</div>
              </div>
            </template>
          </v-switch>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="createDialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="form.busy.value" @click="create">{{ $t('common.create') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="shown.show" max-width="440" persistent>
    <v-card :title="$t('users.tempPasswordTitle')" class="pa-2">
      <v-card-text>
        <p class="text-body-2 mb-3">{{ $t('account.employee.handOver') }}</p>
        <v-text-field :model-value="shown.password" readonly dir="ltr" class="font-weight-bold" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="shown = { show: false, password: '' }">{{ $t('common.done') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
