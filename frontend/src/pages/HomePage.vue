<script setup lang="ts">
/**
 * Home: the answer to "what needs me today", then the numbers with their
 * trend, then where every record stands, then what just happened.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import KpiCard from '../components/KpiCard.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';

type CountMap = Record<string, number>;

interface AttentionItem {
  kind: 'stalled' | 'expiring' | 'custody';
  employeeId: string;
  name: string;
  status: string;
  days: number;
  to: string;
}

interface DashboardData {
  onboarding: CountMap;
  employees: CountMap;
  processes: { gosi: CountMap; medical: CountMap; criminal: CountMap };
  assetForms: CountMap;
  offboardings: CountMap;
  attention: AttentionItem[];
  counts: { stalled: number; expiringDocs: number; custodyWaiting: number };
  trends: { weeks: number; hires: number[]; intakes: number[] };
  recent: Array<{
    id: string;
    entity: string;
    action: string;
    toStatus: string | null;
    actorType: string;
    actorName: string | null;
    at: string;
    subject: string | null;
  }>;
}

const PIPELINE_STAGES = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
  'EXPIRED',
];

const { t, locale } = useI18n();
const auth = useAuthStore();
const data = ref<DashboardData | null>(null);

const sum = (map: CountMap | undefined) => Object.values(map ?? {}).reduce((a, b) => a + b, 0);
const firstName = computed(() => (auth.user?.name ?? '').split(' ')[0] ?? '');

const greeting = computed(() => {
  const hour = new Date().getHours();
  const key = hour < 12 ? 'greetMorning' : hour < 17 ? 'greetAfternoon' : 'greetEvening';
  return t(`dashboard.${key}`, { name: firstName.value });
});

const today = computed(() =>
  new Date().toLocaleDateString(locale.value === 'ar' ? 'ar-SA' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }),
);

const needs = computed(() => data.value?.attention.length ?? 0);
const onboardingTotal = computed(() => sum(data.value?.onboarding));

/** Share of active employees whose track is finished. */
function completion(map: CountMap | undefined): number {
  const total = sum(map);
  if (!total) return 0;
  return Math.round(((map?.['DONE'] ?? 0) / total) * 100);
}

const STAGE_COLOR: Record<string, string> = {
  CREATED: 'secondary',
  AWAITING_FORM: 'warning',
  FORM_RECEIVED: 'primary',
  CONTRACT_CREATION: 'primary',
  AWAITING_CONTRACT_APPROVAL: 'warning',
  EXPIRED: 'error',
};

function attentionText(item: AttentionItem): string {
  if (item.kind === 'expiring') {
    const doc = t(`expiryDocs.types.${item.status}`, item.status);
    return item.days < 0
      ? t('dashboard.expiredAgo', { doc, n: Math.abs(item.days) })
      : t('dashboard.expiresIn', { doc, n: item.days });
  }
  if (item.kind === 'custody') return t('dashboard.custodyWaiting', { n: item.days });
  return t('dashboard.stalledFor', { n: item.days });
}

function attentionChip(item: AttentionItem): { text: string; color: string } {
  if (item.kind === 'expiring') {
    return { text: t('expiryDocs.types.' + item.status, item.status), color: item.days <= 7 ? 'error' : 'warning' };
  }
  if (item.kind === 'custody') return { text: t(`assetStatus.${item.status}`, item.status), color: 'warning' };
  return { text: t(`status.${item.status}`, item.status), color: STAGE_COLOR[item.status] ?? 'warning' };
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function actorLabel(log: DashboardData['recent'][number]): string {
  if (log.actorType === 'LINK') return t('dashboard.viaLink');
  if (log.actorType === 'SYSTEM') return t('dashboard.system');
  return log.actorName ? t('dashboard.by', { name: log.actorName }) : '';
}

const quickActions = computed(() => [
  { key: 'qaNewEmployee', icon: 'user-plus', to: '/employees?new=1', roles: ['HR'] },
  { key: 'qaOnboarding', icon: 'graduation-cap', to: '/employees?filter=onboarding', roles: [] as string[] },
  { key: 'qaReports', icon: 'chart-column', to: '/reports', roles: ['HR'] },
  { key: 'qaEmails', icon: 'mail', to: '/emails', roles: ['HR'] },
].filter((a) => a.roles.length === 0 || auth.hasRole(...a.roles)));

onMounted(async () => {
  data.value = await api.get<DashboardData>('/api/dashboard');
});
</script>

<template>
  <v-container class="home py-6 py-md-8" style="max-width: 1240px">
    <!-- ───── header ───── -->
    <div class="d-flex flex-wrap align-center ga-4 mb-6">
      <div class="flex-grow-1">
        <h1 class="text-h4 font-weight-bold mb-1">{{ greeting }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          {{ today }}
          <template v-if="data">
            · <span :class="needs ? 'text-warning font-weight-medium' : ''">
              {{ needs === 0 ? $t('dashboard.allClear') : needs === 1 ? $t('dashboard.needsYouOne') : $t('dashboard.needsYou', { n: needs }) }}
            </span>
          </template>
        </p>
      </div>
      <v-btn v-if="auth.hasRole('HR')" color="primary" prepend-icon="plus" to="/employees?new=1">
        {{ $t('employees.new') }}
      </v-btn>
    </div>

    <!-- ───── loading ───── -->
    <template v-if="!data">
      <SkeletonBlock variant="kpis" class="mb-4" />
      <v-row>
        <v-col cols="12" md="7"><SkeletonBlock variant="list" :rows="4" /></v-col>
        <v-col cols="12" md="5"><SkeletonBlock variant="card" /></v-col>
      </v-row>
    </template>

    <template v-else>
      <!-- ───── KPIs ───── -->
      <v-row dense class="mb-3">
        <v-col cols="6" md="3">
          <KpiCard
            :label="$t('dashboard.kpiActive')"
            :value="data.employees['ACTIVE'] ?? 0"
            to="/employees?filter=active"
            :trend="data.trends.hires"
            :trend-label="$t('dashboard.hiresTrend')"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiCard
            :label="$t('dashboard.kpiOnboarding')"
            :value="onboardingTotal"
            to="/employees?filter=onboarding"
            :trend="data.trends.intakes"
            :trend-label="$t('dashboard.intakesTrend')"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiCard
            :label="$t('dashboard.kpiStalled')"
            :value="data.counts.stalled"
            :tone="data.counts.stalled ? 'warn' : 'good'"
            :chip="data.counts.stalled ? String(data.counts.stalled) : '✓'"
            to="/employees?filter=onboarding"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiCard
            :label="$t('dashboard.kpiExpiring')"
            :value="data.counts.expiringDocs"
            :tone="data.counts.expiringDocs ? 'warn' : 'good'"
            :chip="data.counts.expiringDocs ? String(data.counts.expiringDocs) : '✓'"
            to="/reports"
          />
        </v-col>
      </v-row>

      <v-row dense>
        <!-- ───── left column ───── -->
        <v-col cols="12" md="7" class="d-flex flex-column ga-3">
          <v-card class="pa-5">
            <div class="d-flex align-center mb-3">
              <h2 class="text-subtitle-1 font-weight-bold">{{ $t('dashboard.attention') }}</h2>
              <v-spacer />
              <v-btn variant="text" size="small" to="/employees?filter=onboarding">{{ $t('dashboard.viewAll') }}</v-btn>
            </div>
            <div v-if="data.attention.length === 0" class="text-body-2 text-medium-emphasis py-4 d-flex align-center ga-2">
              <v-icon icon="circle-check" color="success" size="18" />
              {{ $t('dashboard.attentionEmpty') }}
            </div>
            <div v-else class="attn">
              <router-link v-for="item in data.attention" :key="item.kind + item.employeeId + item.status" :to="item.to" class="attn__row">
                <v-avatar size="34" color="secondary" variant="tonal">
                  <span class="text-caption font-weight-bold">{{ initials(item.name) }}</span>
                </v-avatar>
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 font-weight-medium text-truncate">{{ item.name }}</div>
                  <div class="text-caption text-medium-emphasis text-truncate">{{ attentionText(item) }}</div>
                </div>
                <v-chip size="x-small" :color="attentionChip(item).color" class="status-dot d-none d-sm-inline-flex">
                  {{ attentionChip(item).text }}
                </v-chip>
                <v-btn size="small" variant="tonal" class="d-none d-sm-inline-flex">{{ $t('dashboard.open') }}</v-btn>
                <v-icon icon="chevron-right" size="16" class="d-sm-none text-medium-emphasis flip-rtl" />
              </router-link>
            </div>
          </v-card>

          <v-card class="pa-5">
            <div class="d-flex align-center mb-3">
              <h2 class="text-subtitle-1 font-weight-bold">{{ $t('dashboard.onboardingByStage') }}</h2>
              <v-spacer />
              <span class="text-caption text-medium-emphasis tnum">{{ onboardingTotal }} {{ $t('dashboard.people') }}</span>
            </div>
            <div v-if="onboardingTotal === 0" class="text-body-2 text-medium-emphasis py-2">{{ $t('employees.empty') }}</div>
            <div v-else class="bars">
              <router-link
                v-for="stage in PIPELINE_STAGES.filter((s) => (data!.onboarding[s] ?? 0) > 0)"
                :key="stage"
                :to="`/employees?status=${stage}`"
                class="bar"
              >
                <span class="bar__label text-body-2">{{ $t(`status.${stage}`) }}</span>
                <span class="bar__track"><span class="bar__fill" :style="{ width: `${((data!.onboarding[stage] ?? 0) / onboardingTotal) * 100}%` }" /></span>
                <span class="bar__n text-body-2 font-weight-semibold tnum">{{ data!.onboarding[stage] }}</span>
              </router-link>
            </div>
          </v-card>
        </v-col>

        <!-- ───── right column ───── -->
        <v-col cols="12" md="5" class="d-flex flex-column ga-3">
          <v-card class="pa-5">
            <h2 class="text-subtitle-1 font-weight-bold mb-3">{{ $t('dashboard.quickActions') }}</h2>
            <div class="quick">
              <router-link v-for="qa in quickActions" :key="qa.key" :to="qa.to" class="quick__item">
                <v-icon :icon="qa.icon" size="20" color="primary" />
                <span class="text-body-2 font-weight-medium">{{ $t(`dashboard.${qa.key}`) }}</span>
              </router-link>
            </div>
          </v-card>

          <v-card class="pa-5">
            <div class="d-flex align-center mb-3">
              <h2 class="text-subtitle-1 font-weight-bold">{{ $t('dashboard.tracks') }}</h2>
              <v-spacer />
              <span class="text-caption text-medium-emphasis">{{ $t('dashboard.tracksHint') }}</span>
            </div>
            <div class="bars">
              <div v-for="kind in (['gosi', 'medical', 'criminal'] as const)" :key="kind" class="bar">
                <span class="bar__label text-body-2">{{ $t(`processes.${kind}`) }}</span>
                <span class="bar__track"><span class="bar__fill bar__fill--good" :style="{ width: `${completion(data.processes[kind])}%` }" /></span>
                <span class="bar__n text-body-2 font-weight-semibold tnum">{{ completion(data.processes[kind]) }}%</span>
              </div>
            </div>
          </v-card>

          <v-card class="pa-5">
            <h2 class="text-subtitle-1 font-weight-bold mb-2">{{ $t('dashboard.recent') }}</h2>
            <div class="recent">
              <div v-for="log in data.recent.slice(0, 8)" :key="log.id" class="recent__row">
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 font-weight-medium text-truncate">
                    {{ $t(`audit.${log.action}`, log.action) }}
                    <span class="text-medium-emphasis font-weight-regular"> · {{ $t(`entities.${log.entity}`, log.entity) }}</span>
                  </div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    <template v-if="log.subject">{{ log.subject }}</template>
                    <template v-if="actorLabel(log)"> · {{ actorLabel(log) }}</template>
                  </div>
                </div>
                <time class="text-caption text-medium-emphasis text-no-wrap tnum">{{ when(log.at) }}</time>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<style scoped>
.attn { display: flex; flex-direction: column; }
.attn__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 6px;
  margin: 0 -6px;
  border-radius: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  color: inherit;
  text-decoration: none;
  transition: background 160ms var(--app-ease);
}
.attn__row:first-child { border-top: 0; }
.attn__row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }

.bars { display: flex; flex-direction: column; gap: 10px; }
.bar {
  display: grid;
  grid-template-columns: minmax(90px, 150px) 1fr 44px;
  gap: 12px;
  align-items: center;
  color: inherit;
  text-decoration: none;
}
.bar__label { color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.bar__track { height: 8px; border-radius: 4px; background: rgb(var(--v-theme-surface-variant)); overflow: hidden; }
.bar__fill { display: block; height: 100%; border-radius: 4px; background: rgb(var(--v-theme-primary)); transition: width 400ms var(--app-ease); }
.bar__fill--good { background: rgb(var(--v-theme-success)); }
.bar__n { text-align: end; }

.quick { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.quick__item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-variant));
  color: inherit;
  text-decoration: none;
  transition: background 160ms var(--app-ease), transform 160ms var(--app-ease);
}
.quick__item:hover { background: rgba(var(--v-theme-primary), 0.1); transform: translateY(-1px); }

.recent { display: flex; flex-direction: column; }
.recent__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.recent__row:first-child { border-top: 0; }
[dir='rtl'] .flip-rtl { transform: scaleX(-1); }
</style>
