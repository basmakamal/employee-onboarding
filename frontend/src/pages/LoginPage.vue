<script setup lang="ts">
/**
 * Sign-in: a split page. The photo side carries the brand and a short
 * statement of what the system does; the form side is deliberately small.
 *
 * The photo is real office photography bundled in /public/login-hero.jpg
 * (Pexels licence, free for commercial use). Swap it for a photo of the
 * Riyada team whenever one is available — same file name, nothing else
 * to change.
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { usePreferencesStore } from '../stores/preferences';
import LanguageToggle from '../components/LanguageToggle.vue';

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
  <div class="login">
    <!-- ───── Photo side ───── -->
    <section class="hero" :aria-label="$t('login.brandSub')">
      <img
        class="hero__photo"
        src="/login-hero.jpg"
        alt=""
        fetchpriority="high"
        decoding="async"
      />
      <div class="hero__shade" aria-hidden="true" />

      <header class="brand">
        <span class="brand__logo">
          <img src="/riyada-logo.png" alt="Riyada" />
        </span>
        <span class="brand__text">
          <span class="brand__name">{{ $t('login.brand') }}</span>
          <span class="brand__sub">{{ $t('login.brandSub') }}</span>
        </span>
      </header>

      <div class="hero__copy">
        <span class="hero__eyebrow"><i aria-hidden="true" />{{ $t('login.eyebrow') }}</span>
        <h1 class="hero__headline">{{ $t('login.headline') }}</h1>
        <p class="hero__sub">{{ $t('login.sub') }}</p>
      </div>

      <footer class="hero__foot">
        <span>{{ $t('login.foot') }}</span>
        <span dir="ltr">onboarding.riyada-ksa.com</span>
      </footer>
    </section>

    <!-- ───── Form side ───── -->
    <section class="panel">
      <div class="panel__toggles">
        <LanguageToggle />
        <v-btn
          :icon="prefs.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          :aria-label="$t('actions.theme')"
          variant="text"
          size="small"
          @click="prefs.toggleTheme()"
        />
      </div>

      <v-card class="login-card" max-width="440" width="100%" rounded="xl">
        <v-card-item class="pb-1 pt-6 px-6">
          <h2 class="text-h5 font-weight-bold mb-1">{{ greeting }}</h2>
          <p class="text-body-2 text-medium-emphasis mb-0">{{ $t('login.subtitle') }}</p>
        </v-card-item>

        <v-card-text class="px-6 pt-5">
          <v-expand-transition>
            <v-alert v-if="error" type="error" density="compact" variant="tonal" class="mb-4 text-body-2">
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
              dir="ltr"
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
              append-icon="mdi-arrow-right"
            >
              {{ $t('login.signIn') }}
            </v-btn>
          </v-form>
        </v-card-text>

        <v-card-text class="pt-0 px-6 pb-6 text-center">
          <p class="text-caption text-medium-emphasis mb-0">{{ $t('login.help') }}</p>
        </v-card-text>
      </v-card>

      <p class="panel__foot text-caption text-medium-emphasis">{{ $t('login.internal') }}</p>
    </section>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  background: rgb(var(--v-theme-background));
}

/* ───────── hero ───────── */
.hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(24px, 4vw, 48px);
  color: #f7f6f2;
  background: #0b3a46;
}
.hero__photo {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* Keep the person in frame when the panel is tall and narrow. */
  object-position: 28% center;
  filter: saturate(0.92) contrast(1.04);
  transform: scale(1.02);
}
.hero__shade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(
    to top,
    rgba(11, 58, 70, 0.92) 0%,
    rgba(11, 58, 70, 0.58) 38%,
    rgba(11, 58, 70, 0.18) 70%,
    rgba(11, 58, 70, 0.38) 100%
  );
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
/* The logo is teal on transparent — it needs a light plate to read on the photo. */
.brand__logo {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.12);
}
.brand__logo img {
  display: block;
  height: 28px;
  width: auto;
}
.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.brand__name {
  font-weight: 700;
  font-size: 18px;
}
.brand__sub {
  font-size: 12.5px;
  opacity: 0.85;
}

.hero__copy {
  max-width: 520px;
}
.hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
}
.hero__eyebrow i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e0a458;
}
.hero__headline {
  margin: 18px 0 10px;
  font-size: clamp(26px, 2.6vw, 38px);
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.hero__sub {
  margin: 0;
  font-size: 15.5px;
  line-height: 1.75;
  opacity: 0.9;
  max-width: 46ch;
}
.hero__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  opacity: 0.75;
}

/* ───────── panel ───────── */
.panel {
  position: relative;
  display: grid;
  place-items: center;
  padding: clamp(24px, 4vw, 56px);
}
.panel__toggles {
  position: absolute;
  top: 18px;
  inset-inline-end: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 2;
}
.panel__foot {
  position: absolute;
  bottom: 18px;
  inset-inline: 0;
  text-align: center;
  margin: 0;
}
.login-card {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow:
    0 1px 2px rgba(16, 24, 40, 0.04),
    0 12px 32px -16px rgba(16, 24, 40, 0.18);
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

/* ───────── responsive ───────── */
@media (max-width: 900px) {
  .login {
    grid-template-columns: 1fr;
  }
  .hero {
    min-height: 280px;
    padding: 22px;
  }
  .hero__sub {
    display: none;
  }
  .hero__headline {
    font-size: 24px;
  }
  .panel {
    padding: 24px 18px 64px;
  }
  .panel__toggles {
    position: static;
    justify-content: flex-end;
    width: 100%;
    margin-bottom: 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-card {
    animation: none;
  }
}
</style>
