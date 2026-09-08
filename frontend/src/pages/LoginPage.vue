<script setup lang="ts">
import { computed, ref } from 'vue';
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

const canSubmit = computed(() => !!email.value.trim() && !!password.value && !loading.value);

/** A greeting that fits the hour — the first thing anyone reads here. */
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return t('login.greetMorning');
  if (hour < 17) return t('login.greetAfternoon');
  return t('login.greetEvening');
});

async function submit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = '';
  try {
    await auth.login(email.value.trim(), password.value);
    await router.replace((route.query['redirect'] as string) ?? '/');
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401 ? t('login.invalid') : t('login.unreachable');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <!-- Two soft washes of colour instead of a flat field. -->
    <div class="glow glow--one" aria-hidden="true" />
    <div class="glow glow--two" aria-hidden="true" />

    <div class="login-page__toggles">
      <v-btn variant="text" size="small" prepend-icon="mdi-translate" @click="prefs.toggleLocale()">
        {{ $t('actions.language') }}
      </v-btn>
      <v-btn
        :icon="prefs.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
        :aria-label="$t('actions.theme')"
        variant="text"
        size="small"
        @click="prefs.toggleTheme()"
      />
    </div>

    <div class="login-page__inner">
      <v-card class="login-card px-2 py-4" max-width="440" width="100%">
        <v-card-item class="text-center pb-2">
          <v-avatar color="primary" variant="tonal" size="60" rounded="xl" class="mb-4">
            <v-icon icon="mdi-account-group-outline" size="32" />
          </v-avatar>
          <h1 class="text-h5 font-weight-bold mb-1">{{ greeting }}</h1>
          <p class="text-body-2 text-medium-emphasis">{{ $t('login.subtitle') }}</p>
        </v-card-item>

        <v-card-text class="pt-4">
          <v-expand-transition>
            <v-alert v-if="error" type="error" density="compact" class="mb-4 text-body-2">
              {{ error }}
            </v-alert>
          </v-expand-transition>

          <v-form @submit.prevent="submit">
            <v-text-field
              v-model="email"
              :label="$t('login.email')"
              :placeholder="$t('login.emailPlaceholder')"
              type="email"
              prepend-inner-icon="mdi-email-outline"
              autocomplete="username"
              autofocus
              dir="ltr"
              class="mb-3"
            />
            <v-text-field
              v-model="password"
              :label="$t('login.password')"
              :type="showPassword ? 'text' : 'password'"
              prepend-inner-icon="mdi-lock-outline"
              :append-inner-icon="showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
              autocomplete="current-password"
              @click:append-inner="showPassword = !showPassword"
            />

            <v-btn
              type="submit"
              color="primary"
              size="large"
              block
              rounded="lg"
              class="mt-5"
              :loading="loading"
              :disabled="!canSubmit"
            >
              {{ $t('login.signIn') }}
            </v-btn>
          </v-form>
        </v-card-text>

        <v-card-text class="pt-0 text-center">
          <p class="text-caption text-medium-emphasis mb-0">{{ $t('login.help') }}</p>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: hidden;
}

.login-page__inner {
  width: 100%;
  display: grid;
  place-items: center;
  position: relative;
  z-index: 1;
}

.login-page__toggles {
  position: absolute;
  top: 16px;
  inset-inline-end: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 2;
}

/* Ambient colour: large, very soft, and behind everything. */
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.5;
  pointer-events: none;
}
.glow--one {
  width: 460px;
  height: 460px;
  top: -160px;
  inset-inline-start: -140px;
  background: rgba(var(--v-theme-primary), 0.18);
}
.glow--two {
  width: 380px;
  height: 380px;
  bottom: -140px;
  inset-inline-end: -120px;
  background: rgba(var(--v-theme-secondary), 0.16);
}

.login-card {
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-card {
    animation: none;
  }
}
</style>
