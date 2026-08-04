import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  api,
  onSessionChange,
  setAccessToken,
  tryRefresh,
  type SessionUser,
} from '../api/client';

/**
 * Session state. The access token stays in JS memory (never storage);
 * a page reload restores the session silently through the httpOnly
 * refresh cookie.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null);
  const restored = ref(false);

  const isAuthenticated = computed(() => user.value !== null);

  /** Group check for UI gating — ADMIN passes everything. */
  function hasRole(...roles: string[]): boolean {
    const role = user.value?.role;
    return role === 'ADMIN' || (role !== undefined && roles.includes(role));
  }

  // Keep the store in sync with silent refreshes done by the api client.
  onSessionChange((sessionUser) => {
    user.value = sessionUser;
  });

  async function login(email: string, password: string): Promise<void> {
    const result = await api.post<{ user: SessionUser; accessToken: string }>('/api/auth/login', {
      email,
      password,
    });
    setAccessToken(result.accessToken);
    user.value = result.user;
  }

  /** Called once by the router guard on first navigation after load. */
  async function restore(): Promise<void> {
    if (restored.value) return;
    restored.value = true;
    await tryRefresh().catch(() => null);
  }

  async function logout(): Promise<void> {
    await api.post('/api/auth/logout').catch(() => null);
    setAccessToken('');
    user.value = null;
  }

  return { user, isAuthenticated, hasRole, login, logout, restore };
});
