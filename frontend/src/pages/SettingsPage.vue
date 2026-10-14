<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useForm } from '../composables/useForm';
import { rules } from '../validation/rules';

interface MailSettings {
  provider: 'console' | 'gmail' | 'microsoft' | 'custom';
  host?: string;
  port?: number;
  user?: string;
  from?: string;
  hasPassword: boolean;
  /** company = its own settings; main = borrowing the main company's; environment = server defaults. */
  source?: 'company' | 'main' | 'environment';
}

const PRESETS: Record<string, { host: string; port: number }> = {
  gmail: { host: 'smtp.gmail.com', port: 587 },
  microsoft: { host: 'smtp.office365.com', port: 587 },
};

const { t } = useI18n();
/** Each company has its own settings here — the header says whose. */
const companyName = useActiveCompanyName();
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
const source = ref<MailSettings['source']>('company');
const mailForm = useForm();
const testForm = useForm();

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
  source.value = data.source ?? 'company';
  loaded.value = true;
}

function save() {
  return mailForm.submit(async () => {
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
  });
}

function sendTest() {
  return testForm.submit(async () => {
    await api.post('/api/settings/mail/test', { to: testTo.value.trim() });
    notify(t('settings.testSent'));
  });
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 760px">
    <PageHeader :title="$t('settings.title')" :subtitle="$t('settings.subtitleCompany', { company: companyName })" />

    <v-card v-if="loaded" :title="$t('settings.mail')">
      <v-card-text>
        <FormErrorAlert :form="mailForm" />
        <FormErrorAlert :form="testForm" />
        <v-alert v-if="source !== 'company'" type="info" variant="tonal" density="compact" class="mb-4">
          {{ source === 'main' ? $t('settings.mailInherited', { company: companyName }) : $t('settings.mailEnvironment', { company: companyName }) }}
        </v-alert>
        <v-form :ref="mailForm.bind" @submit.prevent="save">
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
                :label="$t('settings.host') + ' *'"
                :readonly="form.provider !== 'custom'"
                :rules="[rules.required]"
                :error-messages="mailForm.errorsFor('host')"
                dir="ltr"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model="form.port"
                :label="$t('settings.port') + ' *'"
                type="number"
                :readonly="form.provider !== 'custom'"
                :rules="[rules.required, rules.integer(1)]"
                :error-messages="mailForm.errorsFor('port')"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="form.user" :label="$t('settings.user') + ' *'" autocomplete="off" :rules="[rules.required]" :error-messages="mailForm.errorsFor('user')" dir="ltr" />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="form.password"
                :label="$t('settings.password')"
                type="password"
                autocomplete="new-password"
                :placeholder="form.hasPassword ? $t('settings.passwordKept') : ''"
                persistent-placeholder
                :rules="form.hasPassword ? [] : [rules.required]"
                :error-messages="mailForm.errorsFor('password')"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="form.from" :label="$t('settings.from') + ' *'" :rules="[rules.required, rules.email]" :error-messages="mailForm.errorsFor('from')" dir="ltr" />
            </v-col>
          </v-row>
          <v-alert v-if="form.provider === 'gmail'" type="info" variant="tonal" density="compact">
            {{ $t('settings.gmailHint') }}
          </v-alert>
        </template>
        <v-alert v-else type="info" variant="tonal" density="compact">
          {{ $t('settings.consoleHint') }}
        </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-btn color="primary" variant="flat" :loading="mailForm.busy.value" @click="save">
          {{ $t('common.save') }}
        </v-btn>
        <v-spacer />
        <v-form :ref="testForm.bind" class="d-flex align-start" @submit.prevent="sendTest">
        <v-text-field
          v-model="testTo"
          :label="$t('settings.testTo') + ' *'"
          density="compact"
          hide-details="auto"
          :rules="[rules.required, rules.email]"
          :error-messages="testForm.errorsFor('to')"
          style="min-width: 240px; max-width: 260px"
          class="me-2"
          dir="ltr"
        />
        <v-btn
          variant="tonal"
          prepend-icon="mail-check"
          :loading="testForm.busy.value"
          type="submit"
        >
          {{ $t('settings.sendTest') }}
        </v-btn>
        </v-form>
      </v-card-actions>
    </v-card>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
