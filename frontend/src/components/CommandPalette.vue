<script setup lang="ts">
/**
 * Ctrl+K. One list: employees (live search), pages, actions, and the last
 * five things you opened. Keyboard first: arrows move, Enter opens, Esc closes.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

const open = defineModel<boolean>({ default: false });
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

interface Item {
  id: string;
  group: 'employees' | 'pages' | 'actions' | 'recent';
  title: string;
  subtitle?: string;
  icon: string;
  to: string;
  initials?: string;
}
interface EmployeeHit {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string | null;
  department: string | null;
  status: string;
}

const query = ref('');
const active = ref(0);
const hits = ref<Item[]>([]);
const searching = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

const PAGES: Array<{ to: string; key: string; icon: string; roles: string[] }> = [
  { to: '/', key: 'nav.home', icon: 'layout-dashboard', roles: [] },
  { to: '/employees', key: 'nav.employees', icon: 'users', roles: [] },
  { to: '/reports', key: 'nav.reports', icon: 'chart-column', roles: ['HR'] },
  { to: '/emails', key: 'nav.emailLog', icon: 'mail', roles: ['HR'] },
  { to: '/assistant', key: 'nav.assistant', icon: 'sparkles', roles: ['HR'] },
  { to: '/users', key: 'nav.users', icon: 'user-cog', roles: ['ADMIN'] },
  { to: '/ownership', key: 'nav.ownership', icon: 'network', roles: ['ADMIN'] },
  { to: '/automation', key: 'nav.automation', icon: 'zap', roles: ['ADMIN'] },
  { to: '/email-templates', key: 'nav.emailTemplates', icon: 'mail-open', roles: ['ADMIN'] },
  { to: '/calendar', key: 'nav.calendar', icon: 'calendar-days', roles: ['ADMIN'] },
  { to: '/settings', key: 'nav.settings', icon: 'settings', roles: ['ADMIN'] },
];

const RECENT_KEY = 'cmdk-recent';
function readRecent(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Item[];
  } catch {
    return [];
  }
}
function remember(item: Item) {
  const next = [item, ...readRecent().filter((r) => r.to !== item.to)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.map((r) => ({ ...r, group: 'recent' }))));
  } catch {
    /* storage unavailable — recents are a convenience only */
  }
}

const q = computed(() => query.value.trim().toLowerCase());

const pageItems = computed<Item[]>(() =>
  PAGES.filter((p) => p.roles.length === 0 || auth.hasRole(...p.roles))
    .map((p) => ({ id: p.to, group: 'pages' as const, title: t(p.key), icon: p.icon, to: p.to }))
    .filter((p) => !q.value || p.title.toLowerCase().includes(q.value)),
);

const actionItems = computed<Item[]>(() => {
  if (!auth.hasRole('HR')) return [];
  const all: Item[] = [
    { id: 'new-employee', group: 'actions', title: t('nav.newEmployee'), icon: 'user-plus', to: '/employees?new=1' },
  ];
  return all.filter((a) => !q.value || a.title.toLowerCase().includes(q.value));
});

const items = computed<Item[]>(() => {
  const recent = q.value ? [] : readRecent();
  return [...hits.value, ...actionItems.value, ...pageItems.value, ...recent];
});

let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (value) => {
  clearTimeout(timer);
  active.value = 0;
  if (value.trim().length < 2) {
    hits.value = [];
    return;
  }
  timer = setTimeout(async () => {
    searching.value = true;
    try {
      const data = await api.get<{ items: EmployeeHit[] }>(
        `/api/employees?q=${encodeURIComponent(value.trim())}&limit=6&page=1`,
      );
      hits.value = data.items.map((e) => ({
        id: e.id,
        group: 'employees',
        title: `${e.firstName} ${e.lastName}`,
        subtitle: [e.employeeNo, e.department, t(`status.${e.status}`)].filter(Boolean).join(' · '),
        icon: 'user',
        to: `/employees/${e.id}`,
        initials: `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase(),
      }));
    } catch {
      hits.value = [];
    } finally {
      searching.value = false;
    }
  }, 220);
});

watch(open, (v) => {
  if (v) {
    query.value = '';
    hits.value = [];
    active.value = 0;
    setTimeout(() => inputEl.value?.focus(), 50);
  }
});

function pick(item: Item) {
  remember(item);
  open.value = false;
  void router.push(item.to);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = Math.min(active.value + 1, items.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === 'Enter') {
    const item = items.value[active.value];
    if (item) pick(item);
  } else if (e.key === 'Escape') {
    open.value = false;
  }
}

const groupLabel = (g: Item['group']) => t(`cmdk.${g}`);
function groupOf(index: number): string | null {
  const item = items.value[index];
  if (!item) return null;
  const prev = items.value[index - 1];
  return !prev || prev.group !== item.group ? groupLabel(item.group) : null;
}
</script>

<template>
  <v-dialog v-model="open" max-width="600" :scrim="true" transition="dialog-top-transition" class="cmdk-dialog">
    <v-card class="cmdk" rounded="xl" @keydown="onKey">
      <div class="cmdk__input">
        <v-icon icon="search" size="18" class="text-medium-emphasis" />
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          :placeholder="$t('cmdk.placeholder')"
          :aria-label="$t('cmdk.placeholder')"
          autocomplete="off"
          spellcheck="false"
        />
        <v-progress-circular v-if="searching" indeterminate size="16" width="2" color="primary" />
        <kbd v-else>Esc</kbd>
      </div>
      <div class="cmdk__list" role="listbox">
        <template v-for="(item, i) in items" :key="item.group + item.id">
          <div v-if="groupOf(i)" class="cmdk__group label-caps">{{ groupOf(i) }}</div>
          <div
            class="cmdk__item"
            :class="{ 'cmdk__item--active': i === active }"
            role="option"
            :aria-selected="i === active"
            @mouseenter="active = i"
            @click="pick(item)"
          >
            <v-avatar v-if="item.initials" size="26" color="secondary" variant="tonal" rounded="lg">
              <span class="text-caption font-weight-bold">{{ item.initials }}</span>
            </v-avatar>
            <v-icon v-else :icon="item.icon" size="17" class="text-medium-emphasis" />
            <div class="min-w-0 flex-grow-1">
              <div class="text-body-2 font-weight-medium text-truncate">{{ item.title }}</div>
              <div v-if="item.subtitle" class="text-caption text-medium-emphasis text-truncate">{{ item.subtitle }}</div>
            </div>
            <kbd v-if="i === active">↵</kbd>
          </div>
        </template>
        <div v-if="items.length === 0" class="cmdk__empty text-body-2 text-medium-emphasis">
          {{ $t('cmdk.noResults') }}
        </div>
      </div>
      <div class="cmdk__foot text-caption text-medium-emphasis">{{ $t('cmdk.hint') }}</div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cmdk { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); overflow: hidden; }
.cmdk__input {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.cmdk__input input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 15px;
}
kbd {
  font-family: inherit;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface-variant));
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.cmdk__list { max-height: 380px; overflow-y: auto; padding: 6px 0; }
.cmdk__group { padding: 10px 16px 4px; }
.cmdk__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 16px;
  cursor: pointer;
  transition: background 120ms var(--app-ease);
}
.cmdk__item--active { background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary)); }
.cmdk__empty { padding: 28px 16px; text-align: center; }
.cmdk__foot { padding: 8px 16px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
