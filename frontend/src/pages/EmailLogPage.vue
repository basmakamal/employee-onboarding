<script setup lang="ts">
/**
 * Email history — every message the system produced, with its delivery
 * state. Read-only apart from "resend", which creates a new row so the
 * original attempt stays on record.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useConfirm } from '../composables/useConfirm';

interface LogRow {
  id: string;
  channel: 'EMAIL' | 'IN_APP';
  status: 'PENDING' | 'SENT' | 'FAILED';
  recipientEmail: string | null;
  recipient: { name: string; email: string } | null;
  locale: string;
  subject: string | null;
  body: string;
  entity: string | null;
  entityId: string | null;
  templateKey: string | null;
  templateVersion: number | null;
  sentAt: string | null;
  createdAt: string;
}

const { t } = useI18n();
const confirm = useConfirm();

const rows = ref<LogRow[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref(1);
const limit = ref(25);
const search = ref('');
const status = ref<string | null>(null);
const channel = ref<string | null>('EMAIL');
const snackbar = ref({ show: false, text: '', color: 'success' });
const viewing = ref<LogRow | null>(null);
const resending = ref('');

const STATUS_COLOR: Record<LogRow['status'], string> = {
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'error',
};

const headers = computed(() => [
  { title: t('emailLog.when'), key: 'createdAt', sortable: false, width: 150 },
  { title: t('emailLog.recipient'), key: 'recipient', sortable: false },
  { title: t('emailLog.subject'), key: 'subject', sortable: false },
  { title: t('emailLog.template'), key: 'templateKey', sortable: false },
  { title: t('emailLog.status'), key: 'status', sortable: false, width: 120 },
  // Two icon buttons: labelled ones needed ~200px and wrapped out of the row.
  { title: '', key: 'actions', sortable: false, width: 96, nowrap: true, align: 'end' as const },
]);

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 350);
});
watch([status, channel], () => {
  page.value = 1;
  void load();
});

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: String(limit.value) });
    if (search.value.trim()) params.set('q', search.value.trim());
    if (status.value) params.set('status', status.value);
    if (channel.value) params.set('channel', channel.value);
    const data = await api.get<{ items: LogRow[]; total: number }>(`/api/notifications/log?${params}`);
    rows.value = data.items;
    total.value = data.total;
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    loading.value = false;
  }
}

function onOptions(opts: { page: number; itemsPerPage: number }) {
  page.value = opts.page;
  limit.value = opts.itemsPerPage;
  void load();
}

function recipientOf(row: LogRow): string {
  return row.recipient?.name ?? row.recipientEmail ?? '—';
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

async function resend(row: LogRow) {
  const email = row.recipientEmail ?? row.recipient?.email ?? '';
  if (!(await confirm({ title: t('emailLog.resend'), message: t('emailLog.resendConfirm', { email }), confirmText: t('emailLog.resend') }))) return;
  resending.value = row.id;
  try {
    await api.post(`/api/notifications/${row.id}/resend`);
    notify(t('emailLog.resent'));
    viewing.value = null;
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    resending.value = '';
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1200px">
    <div class="d-flex flex-wrap align-center ga-4 mb-6">
      <div>
        <h1 class="text-h4 font-weight-bold">{{ $t('emailLog.title') }}</h1>
        <p class="text-medium-emphasis mt-1 mb-0">{{ $t('emailLog.subtitle') }}</p>
      </div>
    </div>

    <v-card class="mb-4">
      <v-card-text class="d-flex flex-wrap ga-3 align-center">
        <v-text-field
          v-model="search"
          :placeholder="$t('emailLog.search')"
          prepend-inner-icon="search"
          density="compact"
          hide-details
          clearable
          style="min-width: 260px; flex: 1 1 260px"
        />
        <v-select
          v-model="channel"
          :items="[
            { title: $t('emailLog.all'), value: null },
            { title: $t('emailLog.channels.EMAIL'), value: 'EMAIL' },
            { title: $t('emailLog.channels.IN_APP'), value: 'IN_APP' },
          ]"
          :label="$t('emailLog.channel')"
          density="compact"
          hide-details
          style="max-width: 180px"
        />
        <v-select
          v-model="status"
          :items="[
            { title: $t('emailLog.all'), value: null },
            { title: $t('emailLog.statuses.SENT'), value: 'SENT' },
            { title: $t('emailLog.statuses.PENDING'), value: 'PENDING' },
            { title: $t('emailLog.statuses.FAILED'), value: 'FAILED' },
          ]"
          :label="$t('emailLog.status')"
          density="compact"
          hide-details
          style="max-width: 180px"
        />
      </v-card-text>
    </v-card>

    <v-card>
      <v-data-table-server
        :headers="headers"
        :items="rows"
        :items-length="total"
        :loading="loading"
        :page="page"
        :items-per-page="limit"
        :items-per-page-options="[25, 50, 100]"
        @update:options="onOptions"
      >
        <template #item.createdAt="{ item }">
          <span class="text-no-wrap tnum">{{ when(item.createdAt) }}</span>
        </template>
        <template #item.recipient="{ item }">
          <div class="text-body-2 font-weight-medium">{{ recipientOf(item) }}</div>
          <div v-if="item.recipient && item.recipientEmail" class="text-caption text-medium-emphasis">
            {{ item.recipientEmail }}
          </div>
        </template>
        <template #item.subject="{ item }">
          <span class="text-body-2">{{ item.subject || '—' }}</span>
        </template>
        <template #item.templateKey="{ item }">
          <v-chip v-if="item.templateKey" size="x-small" variant="tonal" class="font-weight-medium">
            {{ item.templateKey }}
            <span class="ms-1 text-medium-emphasis">
              {{ item.templateVersion ? $t('emailLog.version', { n: item.templateVersion }) : $t('emailLog.builtIn') }}
            </span>
          </v-chip>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #item.status="{ item }">
          <v-chip :color="STATUS_COLOR[item.status]" size="small" variant="tonal" class="font-weight-medium">
            {{ $t(`emailLog.statuses.${item.status}`) }}
          </v-chip>
        </template>
        <template #item.actions="{ item }">
          <div class="d-flex justify-end flex-nowrap ga-1">
            <v-tooltip :text="$t('emailLog.view')" location="top">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="eye"
                  size="small"
                  variant="text"
                  density="comfortable"
                  :aria-label="$t('emailLog.view')"
                  @click="viewing = item"
                />
              </template>
            </v-tooltip>
            <v-tooltip v-if="item.channel === 'EMAIL'" :text="$t('emailLog.resend')" location="top">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="send"
                  size="small"
                  variant="text"
                  color="primary"
                  density="comfortable"
                  :loading="resending === item.id"
                  :aria-label="$t('emailLog.resend')"
                  @click="resend(item)"
                />
              </template>
            </v-tooltip>
          </div>
        </template>
        <template #no-data>
          <div class="py-12 text-center">
            <v-icon icon="mail" size="40" class="mb-3 text-medium-emphasis" />
            <div class="text-subtitle-1 font-weight-medium">{{ $t('emailLog.empty') }}</div>
            <div class="text-body-2 text-medium-emphasis">{{ $t('emailLog.emptyHint') }}</div>
          </div>
        </template>
      </v-data-table-server>
    </v-card>

    <!-- Message detail -->
    <v-dialog :model-value="!!viewing" max-width="640" @update:model-value="viewing = null">
      <v-card v-if="viewing">
        <div class="px-6 pt-6 pb-2">
          <div class="d-flex align-start ga-3">
            <div class="flex-grow-1 min-w-0">
              <h2 class="text-subtitle-1 font-weight-bold">{{ viewing.subject || '—' }}</h2>
              <p class="text-caption text-medium-emphasis mb-0">
                {{ recipientOf(viewing) }}
                <template v-if="viewing.recipient && viewing.recipientEmail"> · {{ viewing.recipientEmail }}</template>
              </p>
            </div>
            <v-chip :color="STATUS_COLOR[viewing.status]" size="small" variant="tonal" class="font-weight-medium">
              {{ $t(`emailLog.statuses.${viewing.status}`) }}
            </v-chip>
          </div>
        </div>
        <v-card-text>
          <div class="message-body rounded-lg pa-4 text-body-2">{{ viewing.body }}</div>
          <div class="d-flex flex-wrap ga-4 mt-4 text-caption text-medium-emphasis">
            <span>{{ $t('emailLog.created') }}: <span class="tnum">{{ when(viewing.createdAt) }}</span></span>
            <span>
              {{ viewing.sentAt ? $t('emailLog.delivered') : $t('emailLog.notDelivered') }}<template v-if="viewing.sentAt">: <span class="tnum">{{ when(viewing.sentAt) }}</span></template>
            </span>
            <span v-if="viewing.templateKey">
              {{ $t('emailLog.template') }}: {{ viewing.templateKey }}
              ({{ viewing.templateVersion ? $t('emailLog.version', { n: viewing.templateVersion }) : $t('emailLog.builtIn') }})
            </span>
            <span v-if="viewing.entity === 'EMPLOYEE' && viewing.entityId">
              <router-link :to="`/employees/${viewing.entityId}`">{{ $t('emailLog.linkedRecord') }}</router-link>
            </span>
          </div>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="viewing = null">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            v-if="viewing.channel === 'EMAIL'"
            color="primary"
            prepend-icon="send"
            :loading="resending === viewing.id"
            @click="resend(viewing)"
          >
            {{ $t('emailLog.resend') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.message-body {
  white-space: pre-wrap;
  line-height: 1.75;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
