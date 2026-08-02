<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePreferencesStore } from './stores/preferences';
import { useAuthStore } from './stores/auth';

const prefs = usePreferencesStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const drawer = ref(true);

/** Public pages (signed links, login) render without the staff chrome. */
const isPublicPage = () =>
  ['/form/', '/approve-contract/', '/approve-assets/', '/login'].some((p) =>
    route.path.startsWith(p),
  );

const NAV = [
  { to: '/', icon: 'mdi-view-dashboard', key: 'nav.home' },
  { to: '/trainees', icon: 'mdi-school', key: 'nav.trainees' },
  { to: '/employees', icon: 'mdi-badge-account', key: 'nav.employees' },
];

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
    <template v-if="!isPublicPage()">
      <v-app-bar flat border density="comfortable">
        <v-app-bar-nav-icon class="d-md-none" @click="drawer = !drawer" />
        <v-app-bar-title class="font-weight-bold">
          <v-icon icon="mdi-account-group" color="primary" class="me-2" />
          {{ $t('app.title') }}
        </v-app-bar-title>

        <v-btn variant="text" prepend-icon="mdi-translate" @click="prefs.toggleLocale()">
          {{ $t('actions.language') }}
        </v-btn>
        <v-btn
          :icon="prefs.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          :aria-label="$t('actions.toggleTheme')"
          @click="prefs.toggleTheme()"
        />

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
              <v-list-item prepend-icon="mdi-logout" :title="$t('login.signOut')" @click="logout" />
            </v-list>
          </v-card>
        </v-menu>
      </v-app-bar>

      <v-navigation-drawer v-model="drawer" :permanent="$vuetify.display.mdAndUp">
        <v-list nav density="comfortable">
          <v-list-item
            v-for="item in NAV"
            :key="item.to"
            :to="item.to"
            :prepend-icon="item.icon"
            :title="$t(item.key)"
            exact
            rounded="xl"
          />
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
