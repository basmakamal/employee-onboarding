<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { usePreferencesStore } from '../stores/preferences';

const auth = useAuthStore();
const prefs = usePreferencesStore();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    await auth.login(email.value.trim(), password.value);
    const redirect = (route.query['redirect'] as string) ?? '/';
    await router.replace(redirect);
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401 ? t('login.invalid') : t('common.error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap d-flex align-center justify-center">
    <div class="toggles">
      <v-btn variant="text" size="small" prepend-icon="mdi-translate" @click="prefs.toggleLocale()">
        {{ $t('actions.language') }}
      </v-btn>
      <v-btn
        :icon="prefs.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        variant="text"
        size="small"
        @click="prefs.toggleTheme()"
      />
    </div>

    <v-card class="login-card pa-4" width="420" elevation="8">
      <v-card-item class="text-center">
        <v-avatar color="primary" variant="tonal" size="64" class="mb-3">
          <v-icon icon="mdi-account-group" size="36" />
        </v-avatar>
        <v-card-title class="text-h5 font-weight-bold">{{ $t('app.title') }}</v-card-title>
        <v-card-subtitle>{{ $t('login.subtitle') }}</v-card-subtitle>
      </v-card-item>

      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
          {{ error }}
        </v-alert>

        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="email"
            :label="$t('login.email')"
            type="email"
            prepend-inner-icon="mdi-email-outline"
            autocomplete="username"
            class="mb-2"
          />
          <v-text-field
            v-model="password"
            :label="$t('login.password')"
            :type="showPassword ? 'text' : 'password'"
            prepend-inner-icon="mdi-lock-outline"
            :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            autocomplete="current-password"
            @click:append-inner="showPassword = !showPassword"
          />
          <v-btn
            type="submit"
            color="primary"
            size="large"
            block
            class="mt-4"
            :loading="loading"
            :disabled="!email || !password"
          >
            {{ $t('login.signIn') }}
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
}
.login-card {
  animation: rise 0.45s ease both;
}
.toggles {
  position: absolute;
  top: 12px;
  inset-inline-end: 12px;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
