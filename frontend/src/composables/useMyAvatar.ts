import { ref, watch } from 'vue';
import { getAccessToken } from '../api/client';
import { useAuthStore } from '../stores/auth';

/**
 * The signed-in person's own picture as an object URL. The image endpoint is
 * behind the bearer token, so it is fetched, not linked. Shared by every
 * avatar in the shell; re-fetched when `hasPhoto` flips or `bump()` is called
 * after an upload.
 */
const url = ref('');
let loadedFor = '';

async function fetchPhoto(userId: string): Promise<void> {
  try {
    const res = await fetch('/api/auth/me/photo', { headers: { Authorization: `Bearer ${getAccessToken()}` } });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = URL.createObjectURL(blob);
    loadedFor = userId;
  } catch {
    url.value = '';
  }
}

export function useMyAvatar() {
  const auth = useAuthStore();

  watch(
    () => [auth.user?.id, auth.user?.hasPhoto] as const,
    ([id, hasPhoto]) => {
      if (!id || !hasPhoto) {
        if (url.value) URL.revokeObjectURL(url.value);
        url.value = '';
        loadedFor = '';
        return;
      }
      if (loadedFor !== id) void fetchPhoto(id);
    },
    { immediate: true },
  );

  /** Force a reload after the picture changed. */
  function bump() {
    loadedFor = '';
    if (auth.user?.id) void fetchPhoto(auth.user.id);
  }

  return { url, bump };
}
