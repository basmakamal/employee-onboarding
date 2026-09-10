<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePreferencesStore } from './stores/preferences';
import { useAuthStore } from './stores/auth';
import NotificationBell from './components/NotificationBell.vue';
import LanguageToggle from './components/LanguageToggle.vue';

const prefs = usePreferencesStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const drawer = ref(true);
/** Desktop: collapse the menu to an icons-only rail; mobile: hide it fully. */
const rail = ref(false);

/** Public pages (signed links, login) render without the staff chrome. */
const isPublicPage = () =>
  ['/form/', '/approve-assets/', '/exit-interview/', '/login', '/change-password'].some((p) =>
    route.path.startsWith(p),
  );

const NAV = [
  { to: '/', icon: 'mdi-view-dashboard', key: 'nav.home', roles: [] as string[] },
  { to: '/employees', icon: 'mdi-badge-account', key: 'nav.employees', roles: [] as string[] },
  { to: '/reports', icon: 'mdi-chart-box', key: 'nav.reports', roles: ['HR'] },
  { to: '/assistant', icon: 'mdi-robot-happy-outline', key: 'nav.assistant', roles: ['HR'] },
  { to: '/emails', icon: 'mdi-email-outline', key: 'nav.emailLog', roles: ['HR'] },
  // hasRole() lets ADMIN through on any check; listing no other role makes
  // these entries effectively admin-only.
  { to: '/users', icon: 'mdi-account-cog', key: 'nav.users', roles: ['ADMIN'] },
  { to: '/ownership', icon: 'mdi-sitemap', key: 'nav.ownership', roles: ['ADMIN'] },
  { to: '/automation', icon: 'mdi-robot', key: 'nav.automation', roles: ['ADMIN'] },
  { to: '/email-templates', icon: 'mdi-email-edit-outline', key: 'nav.emailTemplates', roles: ['ADMIN'] },
  { to: '/calendar', icon: 'mdi-calendar-star', key: 'nav.calendar', roles: ['ADMIN'] },
  { to: '/settings', icon: 'mdi-cog', key: 'nav.settings', roles: ['ADMIN'] },
];

const navItems = computed(() =>
  NAV.filter((item) => item.roles.length === 0 || auth.hasRole(...item.roles)),
);

const initials = computed(() =>
  (auth.user?.name ?? '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase(),
);

async function logout() {
  await auth.logout();
  await router.push('/login');
}

onMounted(() => prefs.apply());
</script>

<template>
  <v-app>
    <!-- The staff chrome (bar + menu) appears only for a signed-in user.
         On a cold load the router is still restoring the session; drawing
         the chrome before that answer arrives made it flash and vanish
         when the answer was "no session" and the user was sent to login. -->
    <template v-if="!isPublicPage() && auth.isAuthenticated">
      <v-app-bar flat border density="comfortable">
        <v-app-bar-nav-icon
          @click="$vuetify.display.mdAndUp ? (rail = !rail) : (drawer = !drawer)"
        />
        <v-app-bar-title class="font-weight-bold">
          <v-icon icon="mdi-account-group" color="primary" class="me-2" />
          {{ $t('app.title') }}
        </v-app-bar-title>

        <LanguageToggle class="me-2" />
        <v-btn
          :icon="prefs.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          :aria-label="$t('actions.toggleTheme')"
          @click="prefs.toggleTheme()"
        />

        <NotificationBell v-if="auth.user" />

        <v-menu v-if="auth.user">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon class="ms-1">
              <v-avatar color="primary" size="36">
                <span class="text-body-2 font-weight-bold">{{ initials }}</span>
              </v-avatar>
            </v-btn>
          </template>
          <v-card min-width="220">
            <v-card-item>
              <v-card-title class="text-body-1">{{ auth.user.name }}</v-card-title>
              <v-card-subtitle>{{ $t(`roles.${auth.user.role}`) }}</v-card-subtitle>
            </v-card-item>
            <v-divider />
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-shield-key-outline"
                :title="$t('changePassword.menu')"
                to="/change-password"
              />
              <v-list-item prepend-icon="mdi-logout" :title="$t('login.signOut')" @click="logout" />
            </v-list>
          </v-card>
        </v-menu>
      </v-app-bar>

      <v-navigation-drawer
        v-model="drawer"
        :permanent="$vuetify.display.mdAndUp"
        :rail="$vuetify.display.mdAndUp && rail"
      >
        <v-list nav density="comfortable">
          <v-tooltip
            v-for="item in navItems"
            :key="item.to"
            :disabled="!rail"
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
                rounded="xl"
              />
            </template>
          </v-tooltip>
        </v-list>
      </v-navigation-drawer>
    </template>

    <v-main>
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </v-main>
  </v-app>
</template>

<style>
.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
