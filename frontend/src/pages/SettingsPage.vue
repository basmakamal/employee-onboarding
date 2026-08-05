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

async function load() {
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
              <v-text-field v-model="form.user" :label="$t('settings.user')" autocomplete="off" />
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

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
