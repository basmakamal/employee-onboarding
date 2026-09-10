<script setup lang="ts">
/**
 * Set your own password. Reached two ways: forced, right after signing in
 * with a temporary (invitation / reset) password — the router sends every
 * other page here until it is done — or voluntarily from the account menu.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, ApiError, type SessionUser } from '../api/client';
import { useAuthStore } from '../stores/auth';
import LanguageToggle from '../components/LanguageToggle.vue';

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();

const current = ref('');
const next = ref('');
const confirm = ref('');
const show = ref(false);
const loading = ref(false);
const error = ref('');

const forced = computed(() => auth.user?.mustChangePassword === true);
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== next.value);
const tooShort = computed(() => next.value.length > 0 && next.value.length < 8);
const sameAsCurrent = computed(() => next.value.length > 0 && next.value === current.value);
const canSubmit = computed(
  () =>
    !!current.value &&
    next.value.length >= 8 &&
    confirm.value === next.value &&
    !sameAsCurrent.value &&
    !loading.value,
);

async function submit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.post<{ user: SessionUser }>('/api/auth/change-password', {
      currentPassword: current.value,
      newPassword: next.value,
    });
    auth.user = result.user;
    await router.replace('/');
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401 ? t('changePassword.wrongCurrent') : t('common.error');
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await auth.logout();
  await router.replace('/login');
}
</script>

<template>
  <div class="cp">
    <div class="cp__toggles">
      <LanguageToggle />
    </div>

    <v-card class="cp__card" max-width="460" width="100%" rounded="xl">
      <div class="d-flex align-center ga-3 px-6 pt-6 pb-2">
        <v-avatar color="primary" variant="tonal" size="44" rounded="lg">
          <v-icon icon="mdi-shield-key-outline" size="24" />
        </v-avatar>
        <div>
          <h1 class="text-h6 font-weight-bold">{{ $t('changePassword.title') }}</h1>
          <p class="text-caption text-medium-emphasis mb-0">
            {{ forced ? $t('changePassword.forcedHint') : $t('changePassword.subtitle') }}
          </p>
        </div>
      </div>

      <v-card-text class="px-6 pt-4">
        <v-alert v-if="forced" type="info" variant="tonal" density="compact" class="mb-4 text-body-2">
          {{ $t('changePassword.forcedBanner', { name: auth.user?.name ?? '' }) }}
        </v-alert>
        <v-expand-transition>
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4 text-body-2">
            {{ error }}
          </v-alert>
        </v-expand-transition>

        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="current"
            :label="$t('changePassword.current')"
            :type="show ? 'text' : 'password'"
            prepend-inner-icon="mdi-lock-outline"
            autocomplete="current-password"
            autofocus
            dir="ltr"
            class="mb-3"
          />
          <v-text-field
            v-model="next"
            :label="$t('changePassword.new')"
            :type="show ? 'text' : 'password'"
            prepend-inner-icon="mdi-lock-plus-outline"
            autocomplete="new-password"
            dir="ltr"
            :error-messages="
              tooShort ? [$t('users.passwordHint')] : sameAsCurrent ? [$t('changePassword.sameAsCurrent')] : []
            "
            :hint="$t('users.passwordHint')"
            persistent-hint
            class="mb-3"
          />
          <v-text-field
            v-model="confirm"
            :label="$t('changePassword.confirm')"
            :type="show ? 'text' : 'password'"
            prepend-inner-icon="mdi-lock-check-outline"
            :append-inner-icon="show ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
            autocomplete="new-password"
            dir="ltr"
            :error-messages="mismatch ? [$t('changePassword.mismatch')] : []"
            @click:append-inner="show = !show"
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
            {{ $t('changePassword.save') }}
          </v-btn>
        </v-form>
      </v-card-text>

      <v-card-actions class="px-6 pb-5 pt-0">
        <v-btn v-if="!forced" variant="text" to="/">{{ $t('common.cancel') }}</v-btn>
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-logout" @click="signOut">{{ $t('login.signOut') }}</v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<style scoped>
.cp {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  position: relative;
  background: rgb(var(--v-theme-background));
}
.cp__toggles {
  position: absolute;
  top: 18px;
  inset-inline-end: 22px;
}
.cp__card {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow:
    0 1px 2px rgba(16, 24, 40, 0.04),
    0 12px 32px -16px rgba(16, 24, 40, 0.18);
}
</style>
