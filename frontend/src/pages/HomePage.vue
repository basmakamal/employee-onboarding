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

const peopleFacts = computed(() => {
  const c = data.value?.counts;
  const facts: string[] = [];
  if (c?.joinedThisMonth) facts.push(t('dashboard.joinedThisMonth', { n: c.joinedThisMonth }));
  if (onboardingTotal.value) facts.push(t('dashboard.inOnboardingN', { n: onboardingTotal.value }));
  if (inactiveCount.value) facts.push(t('dashboard.inactiveN', { n: inactiveCount.value }));
  if (openTracks.value) facts.push(t('dashboard.tracksOpen', { n: openTracks.value }));
  return facts;
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
            {{ attentionTotal ? $t('dashboard.subtitleNeeds') : $t('dashboard.subtitleClear') }}
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
      <!-- ───── attention ───── -->
      <section v-if="attentionSummary.length" class="sec">
        <div class="sec__head">
          <h2 class="sec__title">{{ $t('dashboard.attention') }}</h2>
        </div>
        <div class="rows">
          <router-link v-for="row in attentionSummary" :key="row.key" :to="row.to" class="rows__item attn">
            <span class="attn__mark" :class="`attn__mark--${row.tone}`" aria-hidden="true" />
            <span class="flex-grow-1 text-body-2 font-weight-medium">{{ row.text }}</span>
            <span class="attn__link text-body-2">{{ $t('common.view') }} <v-icon icon="arrow-right" size="14" class="flip-rtl" /></span>
          </router-link>
        </div>
      </section>

      <v-row>
        <!-- ───── left: people ───── -->
        <v-col cols="12" md="7">
          <section class="sec">
            <div class="sec__head">
              <h2 class="sec__title">{{ $t('dashboard.peopleTitle') }}</h2>
              <router-link to="/employees" class="sec__hint link-quiet">{{ $t('common.viewAll') }}</router-link>
            </div>
            <div class="people">
              <div class="people__count tnum">
                {{ activeCount === 1 ? $t('dashboard.employeesOne') : $t('dashboard.employeesCount', { n: activeCount }) }}
              </div>
              <div v-if="peopleFacts.length" class="people__facts text-body-2 text-medium-emphasis">
                <span v-for="(fact, i) in peopleFacts" :key="i">{{ fact }}</span>
              </div>
            </div>
          </section>

          <section class="sec">
            <div class="sec__head">
              <h2 class="sec__title">{{ $t('dashboard.onboardingTitle') }}</h2>
              <router-link to="/employees?filter=onboarding" class="sec__hint link-quiet">{{ $t('common.viewAll') }}</router-link>
            </div>
            <p class="text-body-2 text-medium-emphasis mb-3">
              {{ onboardingTotal === 0 ? $t('dashboard.onboardingNone') : onboardingTotal === 1 ? $t('dashboard.onboardingWaitingOne') : $t('dashboard.onboardingWaiting', { n: onboardingTotal }) }}
            </p>
            <div v-if="stages.length" class="rows">
              <router-link v-for="stage in stages" :key="stage" :to="`/employees?status=${stage}`" class="rows__item">
                <StatusChip :status="stage" class="flex-grow-1" />
                <span class="text-body-2 font-weight-medium tnum">{{ data.onboarding[stage] }}</span>
                <v-icon icon="chevron-right" size="16" class="text-medium-emphasis flip-rtl" />
              </router-link>
            </div>
          </section>

          <section v-if="data.attention.length" class="sec">
            <div class="sec__head">
              <h2 class="sec__title">{{ $t('dashboard.whoNeedsYou') }}</h2>
            </div>
            <div class="rows">
              <router-link v-for="item in data.attention" :key="item.kind + item.employeeId + item.status" :to="item.to" class="rows__item">
                <v-avatar size="32" :class="avatarTone(item.name)">
                  <span style="font-size: 12px">{{ initials(item.name) }}</span>
                </v-avatar>
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 font-weight-medium text-truncate">{{ item.name }}</div>
                  <div class="text-caption text-medium-emphasis text-truncate">{{ attentionText(item) }}</div>
                </div>
                <StatusChip v-if="item.kind === 'stalled'" :status="item.status" class="d-none d-sm-inline-flex" />
                <v-icon icon="chevron-right" size="16" class="text-medium-emphasis flip-rtl" />
              </router-link>
            </div>
          </section>
        </v-col>

        <!-- ───── right: joiners, upcoming, activity ───── -->
        <v-col cols="12" md="5">
          <section class="sec">
            <div class="sec__head">
              <h2 class="sec__title">{{ $t('dashboard.recentJoiners') }}</h2>
            </div>
            <div class="rows">
              <router-link v-for="j in data.recentJoiners" :key="j.id" :to="`/employees/${j.id}`" class="rows__item">
                <v-avatar size="32" :class="avatarTone(j.name)">
                  <span style="font-size: 12px">{{ initials(j.name) }}</span>
                </v-avatar>
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 font-weight-medium text-truncate">{{ j.name }}</div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    {{ [j.jobTitle, lists.label('DEPARTMENT', j.department) ?? j.department].filter(Boolean).join(' · ') }}
                  </div>
                </div>
                <span class="text-caption text-medium-emphasis text-no-wrap">{{ joined(j.hireDate) }}</span>
              </router-link>
              <div v-if="data.recentJoiners.length === 0" class="rows__empty">{{ $t('dashboard.joinersEmpty') }}</div>
            </div>
          </section>

          <section class="sec">
            <div class="sec__head">
              <h2 class="sec__title">{{ $t('dashboard.upcoming') }}</h2>
              <router-link v-if="upcoming.length" to="/reports" class="sec__hint link-quiet">{{ $t('common.viewAll') }}</router-link>
            </div>
            <div class="rows">
              <router-link v-for="item in upcoming" :key="item.employeeId + item.status" :to="item.to" class="rows__item">
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 font-weight-medium text-truncate">{{ item.name }}</div>
                  <div class="text-caption text-truncate" :class="item.days <= 7 ? 'text-error' : 'text-medium-emphasis'">{{ attentionText(item) }}</div>
                </div>
                <v-icon icon="chevron-right" size="16" class="text-medium-emphasis flip-rtl" />
              </router-link>
              <div v-if="upcoming.length === 0" class="rows__empty">{{ $t('dashboard.upcomingEmpty') }}</div>
            </div>
          </section>

          <section class="sec">
            <div class="sec__head">
              <h2 class="sec__title">{{ $t('dashboard.recent') }}</h2>
            </div>
            <div class="rows">
              <div v-for="log in data.recent.slice(0, 8)" :key="log.id" class="rows__item">
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 text-truncate">
                    <span class="font-weight-medium">{{ $t(`audit.${log.action}`, log.action) }}</span>
                    <span v-if="log.subject" class="text-medium-emphasis"> · {{ log.subject }}</span>
                  </div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    {{ $t(`entities.${log.entity}`, log.entity) }}<template v-if="actorLabel(log)"> · {{ actorLabel(log) }}</template>
                  </div>
                </div>
                <time class="text-caption text-medium-emphasis text-no-wrap tnum">{{ when(log.at) }}</time>
              </div>
              <div v-if="data.recent.length === 0" class="rows__empty">{{ $t('dashboard.recentEmpty') }}</div>
            </div>
          </section>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<style scoped>
.home__head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
.home__title {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.025em;
  margin: 0 0 6px;
}
[dir='rtl'] .home__title { letter-spacing: 0; }
.home__sub {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
}

/* Attention rows: a small coloured mark, the sentence, and where to go. */
.attn__mark { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.attn__mark--warning { background: rgb(var(--v-theme-warning)); }
.attn__mark--info { background: rgb(var(--v-theme-info)); }
.attn__link {
  color: rgb(var(--v-theme-primary));
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

/* People: the number is a sentence, with the facts beneath it. */
.people__count { font-size: 2rem; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; }
.people__facts { display: flex; flex-wrap: wrap; gap: 4px 0; margin-top: 4px; }
.people__facts > span + span::before { content: '·'; margin: 0 8px; opacity: 0.5; }

.link-quiet { color: rgb(var(--v-theme-primary)); text-decoration: none; font-weight: 500; }
.link-quiet:hover { text-decoration: underline; }
[dir='rtl'] .flip-rtl { transform: scaleX(-1); }
</style>
