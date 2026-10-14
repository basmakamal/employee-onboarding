<script setup lang="ts">
/**
 * System health for administrators: is the database and Redis up, is the
 * background work (automation, e-mail delivery, dated changes) running, and
 * how fast are the unbounded tables growing. Technical state only — business
 * history lives in the audit trail.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import { errorText } from '../validation/errors';

interface Health {
  db: { up: boolean; latencyMs: number | null };
  redis: { up: boolean; configured?: boolean };
  queues: { mail: Record<string, number> | null };
  tables: Record<string, number>;
  storage: { totalGb: number; freeGb: number; usedPct: number } | null;
  uptimeSeconds: number;
  jobs: {
    lastAutomationActivity: string | null;
    failedEmailsLast7Days: number;
    stuckEmails: number;
    failedScheduledChanges: number;
    mode: 'worker' | 'inline';
  };
}

const { t, locale } = useI18n();
const health = ref<Health | null>(null);
const error = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    health.value = await api.get<Health>('/api/admin/health');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const ago = (iso: string | null) => {
  if (!iso) return t('health.never');
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return t('health.minutesAgo', { n: min });
  const h = Math.round(min / 60);
  return h < 48 ? t('health.hoursAgo', { n: h }) : new Date(iso).toLocaleString(locale.value.startsWith('ar') ? 'ar-SA-u-ca-gregory' : 'en-GB');
};
const uptime = computed(() => {
  const s = health.value?.uptimeSeconds ?? 0;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  return d ? t('health.daysHours', { d, h }) : t('health.hours', { h });
});

/** One row per check: what it is, its state, and a tone. */
const checks = computed(() => {
  const h = health.value;
  if (!h) return [];
  const j = h.jobs;
  return [
    { key: 'db', ok: h.db.up, value: h.db.up ? t('health.upMs', { ms: h.db.latencyMs ?? 0 }) : t('health.down') },
    {
      key: 'redis',
      ok: h.redis.configured === false ? null : h.redis.up,
      value: h.redis.configured === false ? t('health.notConfigured') : h.redis.up ? t('health.up') : t('health.down'),
    },
    { key: 'automation', ok: j.lastAutomationActivity ? true : null, value: `${ago(j.lastAutomationActivity)} · ${t(`health.mode.${j.mode}`)}` },
    { key: 'failedEmails', ok: j.failedEmailsLast7Days === 0, value: String(j.failedEmailsLast7Days) },
    { key: 'stuckEmails', ok: j.stuckEmails === 0, value: String(j.stuckEmails) },
    { key: 'failedChanges', ok: j.failedScheduledChanges === 0, value: String(j.failedScheduledChanges) },
    { key: 'storage', ok: h.storage ? h.storage.usedPct < 85 : null, value: h.storage ? t('health.disk', h.storage) : '—' },
  ];
});
const tone = (ok: boolean | null) => (ok === null ? 'grey' : ok ? 'success' : 'error');
const iconOf = (ok: boolean | null) => (ok === null ? 'circle-help' : ok ? 'circle-check' : 'circle-alert');
</script>

<template>
  <v-container class="py-8" style="max-width: 900px">
    <PageHeader :title="$t('health.title')" :subtitle="$t('health.subtitle')">
      <v-btn variant="tonal" prepend-icon="refresh-cw" :loading="loading" @click="load">{{ $t('health.refresh') }}</v-btn>
    </PageHeader>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <template v-if="health">
      <v-card class="mb-4">
        <v-list density="comfortable">
          <v-list-item v-for="c in checks" :key="c.key">
            <template #prepend><v-icon :icon="iconOf(c.ok)" :color="tone(c.ok)" /></template>
            <v-list-item-title class="text-body-2 font-weight-medium">{{ $t(`health.checks.${c.key}`) }}</v-list-item-title>
            <v-list-item-subtitle class="text-caption">{{ $t(`health.explain.${c.key}`) }}</v-list-item-subtitle>
            <template #append><span class="text-body-2 tnum" dir="auto">{{ c.value }}</span></template>
          </v-list-item>
        </v-list>
      </v-card>

      <div class="grid">
        <v-card :title="$t('health.mailQueue')">
          <v-card-text>
            <div v-if="!health.queues.mail" class="text-body-2 text-medium-emphasis">{{ $t('health.noQueue') }}</div>
            <div v-for="(n, k) in health.queues.mail ?? {}" v-else :key="k" class="d-flex justify-space-between text-body-2 py-1">
              <span class="text-medium-emphasis">{{ $t(`health.queueStates.${k}`, String(k)) }}</span><span class="tnum">{{ n }}</span>
            </div>
          </v-card-text>
        </v-card>
        <v-card :title="$t('health.tables')">
          <v-card-text>
            <div v-for="(n, k) in health.tables" :key="k" class="d-flex justify-space-between text-body-2 py-1">
              <span class="text-medium-emphasis">{{ $t(`health.tableNames.${k}`, String(k)) }}</span><span class="tnum">{{ n.toLocaleString() }}</span>
            </div>
            <div class="text-caption text-medium-emphasis mt-2">{{ $t('health.uptime', { uptime }) }}</div>
          </v-card-text>
        </v-card>
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
</style>
