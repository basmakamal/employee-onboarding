<script setup lang="ts">
/**
 * Home — a people operations workspace, not an analytics page.
 *
 * Reading order answers HR's morning questions in turn: what needs me today
 * (attention first, each line actionable), how many people we have and what
 * changed, who just joined, what is coming up, and what happened recently.
 * Numbers appear as sentences with context, never as a row of boxes.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useListsStore } from '../stores/lists';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import StatusChip from '../components/StatusChip.vue';

type CountMap = Record<string, number>;

interface AttentionItem {
  kind: 'stalled' | 'expiring' | 'custody';
  employeeId: string;
  name: string;
  status: string;
  days: number;
  to: string;
}

interface Joiner {
  id: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  hireDate: string | null;
}

interface DashboardData {
  onboarding: CountMap;
  employees: CountMap;
  processes: { gosi: CountMap; medical: CountMap; criminal: CountMap };
  attention: AttentionItem[];
  counts: { stalled: number; expiringDocs: number; custodyWaiting: number; joinedThisMonth: number };
  recentJoiners: Joiner[];
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

const PIPELINE_STAGES = ['CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL', 'EXPIRED'];

const { t, locale } = useI18n();
const auth = useAuthStore();
const lists = useListsStore();
const data = ref<DashboardData | null>(null);

const sum = (map: CountMap | undefined) => Object.values(map ?? {}).reduce((a, b) => a + b, 0);
const firstName = computed(() => (auth.user?.name ?? '').split(' ')[0] ?? '');

const greeting = computed(() => {
  const hour = new Date().getHours();
  const key = hour < 12 ? 'greetMorning' : hour < 17 ? 'greetAfternoon' : 'greetEvening';
  return t(`dashboard.${key}`, { name: firstName.value });
});

const today = computed(() =>
  new Date().toLocaleDateString(locale.value === 'ar' ? 'ar-SA' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
);

// ── attention ────────────────────────────────────────────────────────────
const attentionTotal = computed(() => {
  const c = data.value?.counts;
  return c ? c.stalled + c.expiringDocs + c.custodyWaiting : 0;
});

/** One sentence per kind of problem, each pointing where it is fixed. */
const attentionSummary = computed(() => {
  const c = data.value?.counts;
  if (!c) return [];
  const one = (n: number, key: string) => (n === 1 ? t(`dashboard.${key}One`) : t(`dashboard.${key}`, { n }));
  return [
    c.stalled ? { key: 'stalled', text: one(c.stalled, 'attnStalled'), to: '/employees?filter=onboarding', tone: 'warning' } : null,
    c.expiringDocs ? { key: 'expiring', text: one(c.expiringDocs, 'attnExpiring'), to: '/reports', tone: 'warning' } : null,
    c.custodyWaiting ? { key: 'custody', text: one(c.custodyWaiting, 'attnCustody'), to: '/employees?filter=active', tone: 'info' } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);
});

function attentionText(item: AttentionItem): string {
  if (item.kind === 'expiring') {
    const doc = lists.label('DOC_TYPE', item.status) ?? t(`expiryDocs.types.${item.status}`, item.status);
    return item.days < 0
      ? t('dashboard.expiredAgo', { doc, n: Math.abs(item.days) })
      : t('dashboard.expiresIn', { doc, n: item.days });
  }
  if (item.kind === 'custody') return t('dashboard.custodyWaiting', { n: item.days });
  return t('dashboard.stalledFor', { n: item.days });
}

// ── people ───────────────────────────────────────────────────────────────
const activeCount = computed(() => data.value?.employees['ACTIVE'] ?? 0);
const inactiveCount = computed(() => (data.value?.employees['INACTIVE'] ?? 0) + (data.value?.employees['WITHDRAWN'] ?? 0));
const onboardingTotal = computed(() => sum(data.value?.onboarding));

/** Post-conversion tracks (GOSI, medical, criminal record) not yet closed. */
const openTracks = computed(() => {
  const p = data.value?.processes;
  if (!p) return 0;
  const open = (m: CountMap, done: string[]) => Object.entries(m).reduce((n, [k, v]) => (done.includes(k) ? n : n + v), 0);
  return open(p.gosi, ['DONE', 'CANCELLED']) + open(p.medical, ['DONE', 'CANCELLED']) + open(p.criminal, ['DONE']);
});

const stages = computed(() => PIPELINE_STAGES.filter((s) => (data.value?.onboarding[s] ?? 0) > 0));

// ── upcoming ─────────────────────────────────────────────────────────────
const upcoming = computed(() =>
  (data.value?.attention ?? []).filter((a) => a.kind === 'expiring').sort((a, b) => a.days - b.days).slice(0, 6),
);

// ── helpers ──────────────────────────────────────────────────────────────
/** One of six soft tints, always the same for the same person. */
function avatarTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `avatar-tone avatar-tone-${h % 6}`;
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function joined(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t('dashboard.joinedToday');
  if (days <= 30) return t('dashboard.joinedDaysAgo', { n: days });
  return t('dashboard.joinedOn', { date: new Date(iso).toLocaleDateString() });
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

onMounted(async () => {
  data.value = await api.get<DashboardData>('/api/dashboard');
});
</script>

<template>
  <v-container class="home py-6 py-md-8" style="max-width: 1160px">
    <!-- ───── greeting ───── -->
    <header class="home__head">
      <div class="flex-grow-1 min-w-0">
        <h1 class="home__title">{{ greeting }}</h1>
        <p class="home__sub">
          <span class="text-medium-emphasis">{{ today }}.</span>
          <template v-if="data">
            {{ ' ' }}{{ attentionTotal ? $t('dashboard.subtitleNeeds') : $t('dashboard.subtitleClear') }}
          </template>
        </p>
      </div>
      <v-btn v-if="auth.hasRole('HR')" color="primary" prepend-icon="plus" to="/employees?new=1">
        {{ $t('employees.new') }}
      </v-btn>
    </header>

    <!-- ───── loading ───── -->
    <template v-if="!data">
      <SkeletonBlock variant="list" :rows="3" class="mb-6" />
      <v-row>
        <v-col cols="12" md="7"><SkeletonBlock variant="list" :rows="5" /></v-col>
        <v-col cols="12" md="5"><SkeletonBlock variant="card" /></v-col>
      </v-row>
    </template>

    <template v-else>
      <!-- ───── attention: one card, one line per problem, each a link ───── -->
      <v-card v-if="attentionSummary.length" class="panel panel--attention mb-4">
        <div class="panel__head">
          <h2 class="panel__title">{{ $t('dashboard.attention') }}</h2>
        </div>
        <div class="list">
          <router-link v-for="row in attentionSummary" :key="row.key" :to="row.to" class="list__row">
            <span class="mark" :class="`mark--${row.tone}`" aria-hidden="true" />
            <span class="flex-grow-1 list__text">{{ row.text }}</span>
            <span class="list__action">{{ $t('common.view') }} <v-icon icon="arrow-right" size="14" class="flip-rtl" /></span>
          </router-link>
        </div>
      </v-card>

      <!-- ───── people: the numbers, in one calm row ───── -->
      <v-card class="panel mb-4">
        <div class="panel__head">
          <h2 class="panel__title">{{ $t('dashboard.peopleTitle') }}</h2>
          <router-link to="/employees" class="panel__link">{{ $t('common.viewAll') }}</router-link>
        </div>
        <div class="stats">
          <router-link to="/employees?filter=active" class="stat">
            <span class="stat__label">{{ $t('dashboard.kpiActive') }}</span>
            <span class="stat__value tnum">{{ activeCount }}</span>
          </router-link>
          <router-link to="/employees?filter=active" class="stat">
            <span class="stat__label">{{ $t('dashboard.statJoined') }}</span>
            <span class="stat__value tnum">{{ data.counts.joinedThisMonth }}</span>
          </router-link>
          <router-link to="/employees?filter=onboarding" class="stat">
            <span class="stat__label">{{ $t('dashboard.kpiOnboarding') }}</span>
            <span class="stat__value tnum">{{ onboardingTotal }}</span>
          </router-link>
          <router-link to="/reports" class="stat">
            <span class="stat__label">{{ $t('dashboard.statTracks') }}</span>
            <span class="stat__value tnum">{{ openTracks }}</span>
          </router-link>
        </div>
      </v-card>

      <v-row>
        <!-- ───── left ───── -->
        <v-col cols="12" md="7">
          <v-card class="panel mb-4">
            <div class="panel__head">
              <h2 class="panel__title">{{ $t('dashboard.onboardingTitle') }}</h2>
              <router-link to="/employees?filter=onboarding" class="panel__link">{{ $t('common.viewAll') }}</router-link>
            </div>
            <p class="panel__lead">
              {{ onboardingTotal === 0 ? $t('dashboard.onboardingNone') : onboardingTotal === 1 ? $t('dashboard.onboardingWaitingOne') : $t('dashboard.onboardingWaiting', { n: onboardingTotal }) }}
            </p>
            <div v-if="stages.length" class="list">
              <router-link v-for="stage in stages" :key="stage" :to="`/employees?status=${stage}`" class="list__row">
                <StatusChip :status="stage" class="flex-grow-1" />
                <span class="list__num tnum">{{ data.onboarding[stage] }}</span>
                <v-icon icon="chevron-right" size="16" class="list__chev flip-rtl" />
              </router-link>
            </div>
          </v-card>

          <v-card class="panel mb-4">
            <div class="panel__head">
              <h2 class="panel__title">{{ $t('dashboard.whoNeedsYou') }}</h2>
            </div>
            <div v-if="data.attention.length" class="list">
              <router-link v-for="item in data.attention" :key="item.kind + item.employeeId + item.status" :to="item.to" class="list__row">
                <v-avatar size="32" :class="avatarTone(item.name)">
                  <span style="font-size: 12px">{{ initials(item.name) }}</span>
                </v-avatar>
                <div class="min-w-0 flex-grow-1">
                  <div class="list__text text-truncate">{{ item.name }}</div>
                  <div class="list__meta text-truncate">{{ attentionText(item) }}</div>
                </div>
                <StatusChip v-if="item.kind === 'stalled'" :status="item.status" class="d-none d-sm-inline-flex" />
                <v-icon icon="chevron-right" size="16" class="list__chev flip-rtl" />
              </router-link>
            </div>
            <div v-else class="panel__empty">{{ $t('dashboard.attentionEmpty') }}</div>
          </v-card>
        </v-col>

        <!-- ───── right ───── -->
        <v-col cols="12" md="5">
          <v-card class="panel mb-4">
            <div class="panel__head">
              <h2 class="panel__title">{{ $t('dashboard.recentJoiners') }}</h2>
            </div>
            <div v-if="data.recentJoiners.length" class="list">
              <router-link v-for="j in data.recentJoiners" :key="j.id" :to="`/employees/${j.id}`" class="list__row">
                <v-avatar size="32" :class="avatarTone(j.name)">
                  <span style="font-size: 12px">{{ initials(j.name) }}</span>
                </v-avatar>
                <div class="min-w-0 flex-grow-1">
                  <div class="list__text text-truncate">{{ j.name }}</div>
                  <div class="list__meta text-truncate">
                    {{ [j.jobTitle, lists.label('DEPARTMENT', j.department) ?? j.department].filter(Boolean).join(' · ') }}
                  </div>
                </div>
                <span class="list__meta text-no-wrap">{{ joined(j.hireDate) }}</span>
              </router-link>
            </div>
            <div v-else class="panel__empty">{{ $t('dashboard.joinersEmpty') }}</div>
          </v-card>

          <v-card class="panel mb-4">
            <div class="panel__head">
              <h2 class="panel__title">{{ $t('dashboard.upcoming') }}</h2>
              <router-link v-if="upcoming.length" to="/reports" class="panel__link">{{ $t('common.viewAll') }}</router-link>
            </div>
            <div v-if="upcoming.length" class="list">
              <router-link v-for="item in upcoming" :key="item.employeeId + item.status" :to="item.to" class="list__row">
                <div class="min-w-0 flex-grow-1">
                  <div class="list__text text-truncate">{{ item.name }}</div>
                  <div class="list__meta text-truncate" :class="{ 'text-error': item.days <= 7 }">{{ attentionText(item) }}</div>
                </div>
                <v-icon icon="chevron-right" size="16" class="list__chev flip-rtl" />
              </router-link>
            </div>
            <div v-else class="panel__empty">{{ $t('dashboard.upcomingEmpty') }}</div>
          </v-card>

          <v-card class="panel mb-4">
            <div class="panel__head">
              <h2 class="panel__title">{{ $t('dashboard.recent') }}</h2>
            </div>
            <div v-if="data.recent.length" class="list">
              <div v-for="log in data.recent.slice(0, 8)" :key="log.id" class="list__row list__row--static">
                <div class="min-w-0 flex-grow-1">
                  <div class="list__text text-truncate">
                    {{ $t(`audit.${log.action}`, log.action) }}<span v-if="log.subject" class="list__dim"> · {{ log.subject }}</span>
                  </div>
                  <div class="list__meta text-truncate">
                    {{ $t(`entities.${log.entity}`, log.entity) }}<template v-if="actorLabel(log)"> · {{ actorLabel(log) }}</template>
                  </div>
                </div>
                <time class="list__meta text-no-wrap tnum">{{ when(log.at) }}</time>
              </div>
            </div>
            <div v-else class="panel__empty">{{ $t('dashboard.recentEmpty') }}</div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<style scoped>
/* ── header ── */
.home__head { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.home__title { font-size: 1.75rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.025em; margin: 0 0 6px; }
[dir='rtl'] .home__title { letter-spacing: 0; }
.home__sub { margin: 0; font-size: 0.9375rem; line-height: 1.5; }

/* ── one panel shape for every section ──
   Title row, optional lead sentence, then a list. Same paddings everywhere, so the
   eye learns the rhythm once. */
.panel { padding: 0; }
.panel__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px 0; }
.panel__title { font-size: 0.9375rem; font-weight: 600; letter-spacing: -0.005em; margin: 0; }
.panel__link { font-size: 0.8125rem; font-weight: 500; color: rgb(var(--v-theme-primary)); text-decoration: none; }
.panel__link:hover { text-decoration: underline; }
.panel__lead { margin: 6px 18px 4px; font-size: 0.875rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.panel__empty { padding: 14px 18px 18px; font-size: 0.875rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.panel--attention { border-color: rgba(var(--v-theme-warning), 0.35) !important; }

/* Lists inside a panel: rows with hairlines, no extra frame. */
.list { margin-top: 8px; }
.list__row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 18px; color: inherit; text-decoration: none;
  border-top: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 0.8));
  transition: background var(--app-duration) var(--app-ease);
}
a.list__row:hover { background: rgba(var(--v-theme-on-surface), 0.025); }
.list__row > div { min-width: 0; }
.list__row > time, .list__row > span.text-no-wrap, .list__row > .v-avatar, .list__row > .v-icon { flex: none; }
.panel { overflow: hidden; }
.list__text { font-size: 0.875rem; font-weight: 500; }
.list__dim { color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); font-weight: 400; }
.list__meta { font-size: 0.8125rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.list__num { font-size: 0.875rem; font-weight: 600; }
.list__chev { color: rgba(var(--v-theme-on-surface), 0.4); }
.list__action { color: rgb(var(--v-theme-primary)); font-size: 0.8125rem; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.mark { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.mark--warning { background: rgb(var(--v-theme-warning)); }
.mark--info { background: rgb(var(--v-theme-info)); }

/* The people numbers: four figures in one row, label above value. */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 10px; border-top: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 0.8)); }
.stat {
  display: flex; flex-direction: column; gap: 4px; padding: 14px 18px; color: inherit; text-decoration: none;
  border-inline-start: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 0.8));
  transition: background var(--app-duration) var(--app-ease);
}
.stat:first-child { border-inline-start: 0; }
.stat:hover { background: rgba(var(--v-theme-on-surface), 0.025); }
.stat__label { font-size: 0.8125rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.stat__value { font-size: 1.5rem; font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; }
@media (max-width: 700px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .stat:nth-child(3) { border-inline-start: 0; }
  .stat:nth-child(n + 3) { border-top: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 0.8)); }
}
[dir='rtl'] .flip-rtl { transform: scaleX(-1); }
</style>
