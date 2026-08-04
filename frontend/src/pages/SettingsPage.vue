<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';

interface MailSettings {
  provider: 'console' | 'gmail' | 'microsoft' | 'custom';
  host?: string;
  port?: number;
  user?: string;
  from?: string;
  hasPassword: boolean;
}

interface SlaRuleRow {
  id: string;
  processKey: string;
  status: string;
  afterValue: number;
  afterUnit: 'HOURS' | 'CALENDAR_DAYS' | 'WORKING_DAYS';
  action: string;
  notifySubject: boolean;
  notifyRole: string;
  escalateToRole: string | null;
  active: boolean;
}

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];
const UNITS = ['HOURS', 'CALENDAR_DAYS', 'WORKING_DAYS'];

const PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'smtp.gmail.com', port: 587 },
  microsoft: { host: 'smtp.office365.com', port: 587 },
};

const { t } = useI18n();
const loaded = ref(false);
const saving = ref(false);
const testing = ref(false);
const snackbar = ref({ show: false, text: '', color: 'success' });
const form = ref({
  provider: 'console' as MailSettings['provider'],
  host: '',
  port: '587',
  user: '',
  password: '',
  from: '',
  hasPassword: false,
});
const testTo = ref('');

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

function onProvider(provider: string) {
  const preset = PRESETS[provider];
  if (preset) {
    form.value.host = preset.host;
    form.value.port = String(preset.port);
  }
}

interface OwnershipRow {
  id: string;
  processKey: string;
  status: string;
  roles: string[];
}

const ownership = ref<OwnershipRow[]>([]);
const ownershipBusy = ref('');

async function loadOwnership() {
  ownership.value = await api.get<OwnershipRow[]>('/api/settings/ownership');
}

async function updateOwnership(row: OwnershipRow, roles: string[]) {
  if (roles.length === 0) {
    notify(t('ownership.atLeastOne'), 'error');
    await loadOwnership();
    return;
  }
  ownershipBusy.value = row.id;
  try {
    await api.put(`/api/settings/ownership/${row.id}`, { roles });
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    ownershipBusy.value = '';
    await loadOwnership();
  }
}

const rules = ref<SlaRuleRow[]>([]);
const ruleBusy = ref('');

async function loadRules() {
  rules.value = await api.get<SlaRuleRow[]>('/api/settings/sla');
}

async function updateRule(rule: SlaRuleRow, changes: Partial<SlaRuleRow>) {
  ruleBusy.value = rule.id;
  try {
    await api.put(`/api/settings/sla/${rule.id}`, changes);
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    ruleBusy.value = '';
    await loadRules();
  }
}

async function load() {
  await loadRules();
  await loadOwnership();
  const data = await api.get<MailSettings>('/api/settings/mail');
  form.value = {
    provider: data.provider,
    host: data.host ?? '',
    port: String(data.port ?? 587),
    user: data.user ?? '',
    password: '',
    from: data.from ?? '',
    hasPassword: data.hasPassword,
  };
  loaded.value = true;
}

async function save() {
  saving.value = true;
  try {
    const body: Record<string, unknown> = { provider: form.value.provider };
    if (form.value.provider !== 'console') {
      body['host'] = form.value.host || undefined;
      body['port'] = form.value.port ? Number(form.value.port) : undefined;
      body['user'] = form.value.user || undefined;
      if (form.value.password) body['password'] = form.value.password;
      body['from'] = form.value.from || undefined;
    }
    await api.put('/api/settings/mail', body);
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    saving.value = false;
  }
}

async function sendTest() {
  testing.value = true;
  try {
    await api.post('/api/settings/mail/test', { to: testTo.value.trim() });
    notify(t('settings.testSent'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 760px">
    <h1 class="text-h4 font-weight-bold mb-1">{{ $t('settings.title') }}</h1>
    <p class="text-medium-emphasis mb-6">{{ $t('settings.subtitle') }}</p>

    <v-card v-if="loaded" :title="$t('settings.mail')">
      <v-card-text>
        <v-select
          v-model="form.provider"
          :items="[
            { title: $t('settings.providers.console'), value: 'console' },
            { title: 'Gmail', value: 'gmail' },
            { title: 'Microsoft (Office 365)', value: 'microsoft' },
            { title: $t('settings.providers.custom'), value: 'custom' },
          ]"
          :label="$t('settings.provider')"
          @update:model-value="onProvider"
        />

        <template v-if="form.provider !== 'console'">
          <v-row dense>
            <v-col cols="8">
              <v-text-field
                v-model="form.host"
                :label="$t('settings.host')"
                :readonly="form.provider !== 'custom'"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model="form.port"
                :label="$t('settings.port')"
                type="number"
                :readonly="form.provider !== 'custom'"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="form.user"
                :label="$t('settings.user')"
                autocomplete="off"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="form.password"
                :label="$t('settings.password')"
                type="password"
                autocomplete="new-password"
                :placeholder="form.hasPassword ? $t('settings.passwordKept') : ''"
                persistent-placeholder
              />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="form.from" :label="$t('settings.from')" />
            </v-col>
          </v-row>
          <v-alert v-if="form.provider === 'gmail'" type="info" variant="tonal" density="compact">
            {{ $t('settings.gmailHint') }}
          </v-alert>
        </template>
        <v-alert v-else type="info" variant="tonal" density="compact">
          {{ $t('settings.consoleHint') }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-btn color="primary" variant="flat" :loading="saving" @click="save">
          {{ $t('common.save') }}
        </v-btn>
        <v-spacer />
        <v-text-field
          v-model="testTo"
          :label="$t('settings.testTo')"
          density="compact"
          hide-details
          style="max-width: 260px"
          class="me-2"
        />
        <v-btn
          variant="tonal"
          prepend-icon="mdi-email-fast"
          :loading="testing"
          :disabled="!testTo.includes('@')"
          @click="sendTest"
        >
          {{ $t('settings.sendTest') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Status ownership -->
    <v-card v-if="loaded" class="mt-6" :title="$t('ownership.title')" :subtitle="$t('ownership.subtitle')">
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('ownership.machine') }}</th>
            <th>{{ $t('trainees.status') }}</th>
            <th style="width: 320px">{{ $t('ownership.groups') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ownership" :key="row.id">
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
                :disabled="ownershipBusy === row.id"
                @update:model-value="(roles: string[]) => updateOwnership(row, roles)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text class="text-caption text-medium-emphasis">
        {{ $t('ownership.hint') }}
      </v-card-text>
    </v-card>

    <!-- Automation (SLA) rules -->
    <v-card v-if="loaded" class="mt-6" :title="$t('sla.title')" :subtitle="$t('sla.subtitle')">
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('sla.watch') }}</th>
            <th>{{ $t('sla.action') }}</th>
            <th style="width: 220px">{{ $t('sla.after') }}</th>
            <th>{{ $t('sla.notify') }}</th>
            <th>{{ $t('sla.active') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td>
              <div class="font-weight-medium">{{ $t(`entities.${rule.processKey}`, rule.processKey) }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ $t(`status.${rule.status}`, $t(`offboardingStatus.${rule.status}`, $t(`processStatus.${rule.status}`, rule.status))) }}
              </div>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="rule.action === 'EXPIRE' ? 'error' : rule.action === 'ESCALATE' ? 'warning' : 'primary'"
              >
                {{ $t(`sla.actions.${rule.action}`) }}
              </v-chip>
            </td>
            <td>
              <div class="d-flex align-center" style="gap: 6px">
                <v-text-field
                  :model-value="rule.afterValue"
                  type="number"
                  min="1"
                  density="compact"
                  hide-details
                  style="max-width: 76px"
                  :disabled="ruleBusy === rule.id"
                  @change="(e: Event) => updateRule(rule, { afterValue: Number((e.target as HTMLInputElement).value) })"
                />
                <v-select
                  :model-value="rule.afterUnit"
                  :items="UNITS.map((u) => ({ title: $t(`sla.units.${u}`), value: u }))"
                  density="compact"
                  hide-details
                  variant="plain"
                  :disabled="ruleBusy === rule.id"
                  @update:model-value="(afterUnit: SlaRuleRow['afterUnit']) => updateRule(rule, { afterUnit })"
                />
              </div>
            </td>
            <td>
              <v-select
                v-if="rule.action !== 'ESCALATE'"
                :model-value="rule.notifyRole"
                :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
                density="compact"
                hide-details
                variant="plain"
                style="max-width: 170px"
                :disabled="ruleBusy === rule.id"
                @update:model-value="(notifyRole: string) => updateRule(rule, { notifyRole })"
              />
              <v-select
                v-else
                :model-value="rule.escalateToRole ?? 'ADMIN'"
                :items="ROLES.map((r) => ({ title: `⬆ ${$t(`roles.${r}`)}`, value: r }))"
                density="compact"
                hide-details
                variant="plain"
                style="max-width: 170px"
                :disabled="ruleBusy === rule.id"
                @update:model-value="(escalateToRole: string) => updateRule(rule, { escalateToRole })"
              />
            </td>
            <td>
              <v-switch
                :model-value="rule.active"
                color="success"
                density="compact"
                hide-details
                :disabled="ruleBusy === rule.id"
                @update:model-value="(active: unknown) => updateRule(rule, { active: Boolean(active) })"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text class="text-caption text-medium-emphasis">
        {{ $t('sla.hint') }}
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
