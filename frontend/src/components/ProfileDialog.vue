<script setup lang="ts">
/**
 * "My profile": the signed-in person's own picture and display name.
 * Email and role are shown but owned by the administrator.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError, getAccessToken, type SessionUser } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useMyAvatar } from '../composables/useMyAvatar';

const open = defineModel<boolean>({ default: false });
const auth = useAuthStore();
const { t } = useI18n();
const avatar = useMyAvatar();

const name = ref('');
const saving = ref(false);
const uploading = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const preview = ref('');

watch(open, (v) => {
  if (v) {
    name.value = auth.user?.name ?? '';
    error.value = '';
    preview.value = '';
  }
});

const initials = computed(() =>
  (auth.user?.name ?? '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase(),
);
const canSave = computed(() => name.value.trim().length > 0 && name.value.trim() !== auth.user?.name);

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const res = await api.put<{ user: SessionUser }>('/api/auth/me', { name: name.value.trim() });
    auth.user = res.user;
    open.value = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('common.error');
  } finally {
    saving.value = false;
  }
}

async function onPicked(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = '';
  preview.value = URL.createObjectURL(file);
  try {
    const body = new FormData();
    body.append('photo', file);
    const res = await fetch('/api/auth/me/photo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      body,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(data?.error?.message ?? t('common.error'));
    }
    const data = (await res.json()) as { user: SessionUser };
    auth.user = data.user;
    avatar.bump();
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('common.error');
    preview.value = '';
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="440">
    <v-card>
      <div class="px-6 pt-6 pb-2">
        <h2 class="text-subtitle-1 font-weight-bold">{{ $t('account.title') }}</h2>
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('account.subtitle') }}</p>
      </div>
      <v-card-text class="pt-4">
        <v-alert v-if="error" type="error" density="compact" class="mb-4 text-body-2">{{ error }}</v-alert>

        <div class="d-flex align-center ga-4 mb-5">
          <div class="position-relative">
            <v-avatar size="72" color="primary" variant="tonal" rounded="xl">
              <v-img v-if="preview || avatar.url.value" :src="preview || avatar.url.value" cover />
              <span v-else class="text-h5 font-weight-bold">{{ initials }}</span>
            </v-avatar>
            <v-progress-circular v-if="uploading" indeterminate size="72" width="2" color="primary" class="photo-ring" />
          </div>
          <div class="flex-grow-1">
            <div class="text-body-2 font-weight-semibold">{{ $t('account.photo') }}</div>
            <div class="text-caption text-medium-emphasis mb-2">{{ $t('account.photoHint') }}</div>
            <v-btn size="small" variant="tonal" prepend-icon="camera" :loading="uploading" @click="fileInput?.click()">
              {{ $t('account.upload') }}
            </v-btn>
            <input ref="fileInput" type="file" accept="image/jpeg,image/png" class="d-none" @change="onPicked" />
          </div>
        </div>

        <v-text-field v-model="name" :label="$t('fields.name')" prepend-inner-icon="user" class="mb-1" />
        <v-text-field :model-value="auth.user?.email" :label="$t('fields.email')" prepend-inner-icon="mail" readonly dir="ltr" class="mb-1" />
        <v-text-field :model-value="$t(`roles.${auth.user?.role}`)" :label="$t('users.role')" prepend-inner-icon="shield-check" readonly />
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('account.adminOnly') }}</p>
      </v-card-text>
      <v-card-actions class="px-6 pb-5 pt-2">
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn variant="flat" color="primary" class="px-5" :loading="saving" :disabled="!canSave" @click="save">
          {{ $t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.photo-ring { position: absolute; inset: 0; }
</style>
