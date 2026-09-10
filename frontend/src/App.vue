<script setup lang="ts">
/**
 * The application shell: a grouped sidebar (Work · Insights · Administration)
 * that collapses to an icon rail on tablets, a slim top bar with breadcrumb,
 * a bottom navigation bar on phones, the command palette (Ctrl+K) and the
 * single confirmation dialog every page shares.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { usePreferencesStore } from './stores/preferences';
import { useAuthStore } from './stores/auth';
import NotificationBell from './components/NotificationBell.vue';
import LanguageToggle from './components/LanguageToggle.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import CommandPalette from './components/CommandPalette.vue';
import ProfileDialog from './components/ProfileDialog.vue';
import { useMyAvatar } from './composables/useMyAvatar';

const prefs = usePreferencesStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const display = useDisplay();
const avatar = useMyAvatar();

const drawer = ref(true);
const profileOpen = ref(false);
/** Desktop: collapse the menu to an icons-only rail. Remembered per browser. */
const rail = ref(localStorage.getItem('nav-rail') === '1');
const palette = ref(false);

/** Pages that render without the staff chrome (signed links, login, first password). */
const isBare = computed(() =>
  ['/form/', '/approve-assets/', '/exit-interview/', '/login', '/change-password'].some((p) =>
    route.path.startsWith(p),
  ),
);
const isRail = computed(() => display.mdAndUp.value && rail.value);

interface NavItem { to: string; icon: string; key: string; roles: string[] }
interface NavGroup { key: string; items: NavItem[] }

// hasRole() lets ADMIN through on any check; listing only ADMIN makes an
// entry admin-only.
const GROUPS: NavGroup[] = [
  {
    key: 'nav.groupWork',
    items: [
      { to: '/', icon: 'layout-dashboard', key: 'nav.home', roles: [] },
      { to: '/employees', icon: 'users', key: 'nav.employees', roles: [] },
      { to: '/emails', icon: 'mail', key: 'nav.emailLog', roles: ['HR'] },
    ],
  },
  {
    key: 'nav.groupInsights',
    items: [
      { to: '/reports', icon: 'chart-column', key: 'nav.reports', roles: ['HR'] },
      { to: '/assistant', icon: 'sparkles', key: 'nav.assistant', roles: ['HR'] },
    ],
  },
  {
    key: 'nav.groupAdmin',
    items: [
      { to: '/users', icon: 'user-cog', key: 'nav.users', roles: ['ADMIN'] },
      { to: '/ownership', icon: 'network', key: 'nav.ownership', roles: ['ADMIN'] },
      { to: '/automation', icon: 'zap', key: 'nav.automation', roles: ['ADMIN'] },
      { to: '/email-templates', icon: 'mail-open', key: 'nav.emailTemplates', roles: ['ADMIN'] },
      { to: '/calendar', icon: 'calendar-days', key: 'nav.calendar', roles: ['ADMIN'] },
      { to: '/settings', icon: 'settings', key: 'nav.settings', roles: ['ADMIN'] },
    ],
  },
];

const groups = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.length === 0 || auth.hasRole(...i.roles)),
  })).filter((g) => g.items.length > 0),
);

/** Breadcrumb title: the nav entry whose path is the longest prefix of the route. */
const currentKey = computed(() => {
  const all = GROUPS.flatMap((g) => g.items).filter((i) => i.to !== '/');
  const match = all
    .filter((i) => route.path === i.to || route.path.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.key;
  if (route.path.startsWith('/offboardings')) return 'nav.employees';
  return null;
});

/** Phone bottom bar: the places HR goes most, plus the one big action. */
const bottomItems = computed(() =>
  [
    { to: '/', icon: 'layout-dashboard', key: 'nav.home', roles: [] as string[] },
    { to: '/employees', icon: 'users', key: 'nav.people', roles: [] as string[] },
    { to: '/emails', icon: 'mail', key: 'nav.inbox', roles: ['HR'] },
  ].filter((i) => i.roles.length === 0 || auth.hasRole(...i.roles)),
);

const initials = computed(() =>
  (auth.user?.name ?? '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase(),
);

function toggleRail() {
  rail.value = !rail.value;
  localStorage.setItem('nav-rail', rail.value ? '1' : '0');
}

async function logout() {
  await auth.logout();
  await router.push('/login');
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.value = !palette.value;
  }
}

onMounted(() => {
  prefs.apply();
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <v-app>
    <!-- Chrome only for a signed-in user: on a cold load the router is still
         restoring the session, and drawing it early made it flash. -->
    <template v-if="!isBare && auth.isAuthenticated">
      <!-- ───────── sidebar (desktop: full or rail · phone: off-canvas) ───────── -->
      <v-navigation-drawer
        v-model="drawer"
        :permanent="display.mdAndUp.value"
        :rail="isRail"
        :temporary="!display.mdAndUp.value"
        rail-width="68"
        width="252"
        class="shell-drawer"
      >
        <div class="shell-brand" :class="{ 'shell-brand--rail': isRail }">
          <img src="/riyada-logo.png" alt="Riyada" class="shell-brand__logo" />
          <b v-if="!isRail" class="shell-brand__text">{{ $t('app.title') }}</b>
          <v-btn
            v-if="display.mdAndUp.value && !rail"
            icon="panel-left-close"
            variant="text"
            size="small"
            class="ms-auto flip-rtl"
            :aria-label="$t('common.more')"
            @click="toggleRail"
          />
        </div>

        <button
          type="button"
          class="shell-search"
          :class="{ 'shell-search--rail': isRail }"
          :aria-label="$t('common.search')"
          @click="palette = true"
        >
          <v-icon icon="search" size="16" />
          <template v-if="!isRail">
            <span class="flex-grow-1 text-start text-truncate">{{ $t('nav.searchPlaceholder') }}</span>
            <kbd>Ctrl K</kbd>
          </template>
        </button>

        <v-list nav density="comfortable" class="shell-nav">
          <template v-for="group in groups" :key="group.key">
            <div v-if="!isRail" class="shell-nav__group label-caps">{{ $t(group.key) }}</div>
            <v-divider v-else class="my-2 mx-3" />
            <v-tooltip
              v-for="item in group.items"
              :key="item.to"
              :disabled="!isRail"
              location="end"
              :text="$t(item.key)"
            >
              <template #activator="{ props }">
                <v-list-item
                  v-bind="props"
                  :to="item.to"
                  :prepend-icon="item.icon"
                  :title="$t(item.key)"
                  exact
                  rounded="lg"
                  class="shell-nav__item"
                  @click="!display.mdAndUp.value && (drawer = false)"
                />
              </template>
            </v-tooltip>
          </template>
        </v-list>

        <template #append>
          <div class="shell-user" :class="{ 'shell-user--rail': isRail }">
            <v-btn
              v-if="isRail"
              icon="panel-left-open"
              variant="text"
              size="small"
              class="flip-rtl"
              :aria-label="$t('common.more')"
              @click="toggleRail"
            />
            <template v-else>
              <!-- The card is the shortcut to "My profile"; account actions live in the top bar. -->
              <button type="button" class="shell-user__btn" @click="profileOpen = true">
                <v-avatar color="primary" variant="tonal" size="34">
                  <v-img v-if="avatar.url.value" :src="avatar.url.value" cover />
                  <span v-else class="text-caption font-weight-bold">{{ initials }}</span>
                </v-avatar>
                <div class="min-w-0 flex-grow-1 text-start">
                  <div class="text-body-2 font-weight-medium text-truncate">{{ auth.user?.name }}</div>
                  <div class="text-caption text-medium-emphasis">{{ $t(`roles.${auth.user?.role}`) }}</div>
                </div>
                <v-icon icon="chevron-right" size="16" class="text-medium-emphasis flip-rtl" />
              </button>
            </template>
          </div>
        </template>
      </v-navigation-drawer>

      <!-- ───────── top bar ───────── -->
      <v-app-bar flat density="comfortable" class="shell-bar">
        <v-app-bar-nav-icon
          v-if="!display.mdAndUp.value"
          icon="menu"
          :aria-label="$t('nav.more')"
          @click="drawer = !drawer"
        />
        <nav class="shell-bar__crumbs text-body-2" aria-label="Breadcrumb">
          <router-link to="/" class="text-medium-emphasis text-decoration-none">{{ $t('nav.home') }}</router-link>
          <template v-if="currentKey">
            <v-icon icon="chevron-right" size="14" class="mx-1 text-medium-emphasis flip-rtl" />
            <span class="font-weight-medium">{{ $t(currentKey) }}</span>
          </template>
        </nav>
        <v-spacer />
        <v-btn
          v-if="display.smAndDown.value"
          icon="search"
          variant="text"
          :aria-label="$t('common.search')"
          @click="palette = true"
        />
        <LanguageToggle v-if="display.mdAndUp.value" class="me-2" />
        <v-btn
          :icon="prefs.dark ? 'sun' : 'moon'"
          variant="text"
          :aria-label="$t('actions.toggleTheme')"
          @click="prefs.toggleTheme()"
        />
        <NotificationBell />

        <!-- Account menu: profile, password, sign out -->
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" class="ms-1" :aria-label="$t('account.menu')">
              <v-avatar color="primary" variant="tonal" size="32">
                <v-img v-if="avatar.url.value" :src="avatar.url.value" cover />
                <span v-else class="text-caption font-weight-bold">{{ initials }}</span>
              </v-avatar>
            </v-btn>
          </template>
          <v-card min-width="240">
            <div class="d-flex align-center ga-3 px-4 pt-4 pb-2">
              <v-avatar color="primary" variant="tonal" size="40">
                <v-img v-if="avatar.url.value" :src="avatar.url.value" cover />
                <span v-else class="text-body-2 font-weight-bold">{{ initials }}</span>
              </v-avatar>
              <div class="min-w-0">
                <div class="text-body-2 font-weight-semibold text-truncate">{{ auth.user?.name }}</div>
                <div class="text-caption text-medium-emphasis text-truncate" dir="ltr">{{ auth.user?.email }}</div>
              </div>
            </div>
            <v-divider />
            <v-list density="compact">
              <v-list-item prepend-icon="user" :title="$t('account.title')" @click="profileOpen = true" />
              <v-list-item prepend-icon="key-round" :title="$t('changePassword.menu')" to="/change-password" />
              <v-list-item prepend-icon="log-out" :title="$t('login.signOut')" @click="logout" />
            </v-list>
          </v-card>
        </v-menu>
      </v-app-bar>

      <ProfileDialog v-model="profileOpen" />

      <!-- ───────── phone bottom navigation ───────── -->
      <v-bottom-navigation v-if="display.smAndDown.value" grow class="shell-bottom" height="64" :elevation="0">
        <v-btn v-for="item in bottomItems" :key="item.to" :to="item.to" exact :value="item.to">
          <v-icon :icon="item.icon" size="20" />
          <span class="text-caption">{{ $t(item.key) }}</span>
        </v-btn>
        <v-btn v-if="auth.hasRole('HR')" to="/employees?new=1" :aria-label="$t('nav.newEmployee')">
          <span class="shell-bottom__fab"><v-icon icon="plus" size="22" /></span>
          <span class="text-caption">{{ $t('common.new') }}</span>
        </v-btn>
        <v-btn value="more" :aria-label="$t('nav.more')" @click="drawer = true">
          <v-icon icon="menu" size="20" />
          <span class="text-caption">{{ $t('nav.more') }}</span>
        </v-btn>
      </v-bottom-navigation>

      <CommandPalette v-model="palette" />
    </template>

    <v-main :class="{ 'shell-main--phone': !isBare && auth.isAuthenticated && display.smAndDown.value }">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </v-main>

    <ConfirmDialog />
  </v-app>
</template>

<style>
.shell-drawer {
  border-inline-end: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}
.shell-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 8px;
  min-height: 56px;
}
.shell-brand--rail { justify-content: center; padding-inline: 8px; }
.shell-brand__logo { height: 26px; width: auto; display: block; }
.shell-brand__text { font-family: var(--font-display); font-size: 14px; white-space: nowrap; }
.shell-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 20px);
  margin: 4px 10px 8px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 160ms var(--app-ease), background 160ms var(--app-ease);
}
.shell-search:hover { border-color: rgba(var(--v-theme-primary), 0.5); }
.shell-search--rail { width: 40px; margin-inline: auto; justify-content: center; padding: 8px; }
.shell-search kbd {
  font-family: inherit;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}
.shell-nav { padding-inline: 10px; }
.shell-nav__group { padding: 12px 10px 4px; }
.shell-nav__item { min-height: 40px; }
.shell-nav__item.v-list-item--active {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.shell-nav__item.v-list-item--active .v-list-item__overlay { opacity: 0; }
.shell-nav__item.v-list-item--active::after {
  content: '';
  position: absolute;
  inset-inline-start: -10px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 3px;
  background: rgb(var(--v-theme-primary));
  opacity: 1;
  border: 0;
}
.shell-user {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.shell-user--rail { justify-content: center; border: 0; padding: 4px; }
.shell-user__btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-radius: 10px;
  padding: 2px;
}
.shell-user__btn:hover { background: rgba(var(--v-theme-on-surface), 0.04); }
.shell-bar {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
  background: rgba(var(--v-theme-background), 0.85) !important;
  backdrop-filter: blur(10px);
}
.shell-bar__crumbs { display: flex; align-items: center; padding-inline-start: 12px; }
.shell-bottom {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)) !important;
}
.shell-bottom .v-btn { min-width: 0; }
.shell-bottom__fab {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  display: grid;
  place-items: center;
  margin-top: -18px;
  box-shadow: var(--app-shadow-md);
}
.shell-main--phone { padding-bottom: 64px !important; }
[dir='rtl'] .flip-rtl { transform: scaleX(-1); }
</style>
