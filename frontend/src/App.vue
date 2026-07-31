<script setup lang="ts">
import { onMounted } from 'vue';
import { usePreferencesStore } from './stores/preferences';

const prefs = usePreferencesStore();
onMounted(() => prefs.apply());
</script>

<template>
  <v-app>
    <v-app-bar flat border density="comfortable">
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
    </v-app-bar>

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
