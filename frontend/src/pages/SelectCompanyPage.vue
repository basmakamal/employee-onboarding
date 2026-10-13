<script setup lang="ts">
/**
 * The company selector — the first screen for anyone who may work in more
 * than one company (super admins). It shows companies only: names, codes
 * and head-counts. No employees, branches, contracts or anything else
 * company-specific appears here, by design.
 */
import { computed, onMounted, ref } from 'vue';
import { errorText } from '../validation/errors';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, type SessionCompany } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface CompanyRow extends SessionCompany {
  active?: boolean;
  _count?: { employees: number; orgUnits: number };
}

const { t, locale } = useI18n();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const search = ref('');
const busy = ref('');
const error = ref('');
const counts = ref<Record<string, CompanyRow['_count']>>({});

const name = (c: SessionCompany) => (locale.value.startsWith('ar') ? c.nameAr : c.nameEn);
const other = (c: SessionCompany) => (locale.value.startsWith('ar') ? c.nameEn : c.nameAr);

const companies = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = auth.user?.companies ?? [];
  if (!q) return all;
  return all.filter((c) => [c.nameAr, c.nameEn, c.code].some((v) => v.toLowerCase().includes(q)));
});

/** Head-counts come from the global companies API (counts only) — optional, for admins. */
onMounted(async () => {
  if (!auth.can('companies.manage')) return;
  try {
    const rows = await api.get<CompanyRow[]>('/api/companies');
    counts.value = Object.fromEntries(rows.map((r) => [r.id, r._count]));
  } catch {
    /* counts are decoration; the page works without them */
  }
});

async function choose(company: SessionCompany) {
  busy.value = company.id;
  error.value = '';
  try {
    await auth.selectCompany(company.id);
    const redirect = typeof route.query['redirect'] === 'string' ? route.query['redirect'] : '/';
    await router.replace(redirect.startsWith('/select-company') ? '/' : redirect);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <v-container class="select-company">
    <div class="select-company__head">
      <v-icon icon="fluent:building-people" size="40" />
      <h1 class="select-company__title">{{ $t('company.selectTitle') }}</h1>
      <p class="text-body-2 text-medium-emphasis">{{ $t('company.selectSubtitle') }}</p>
    </div>

    <v-text-field
      v-if="(auth.user?.companies.length ?? 0) > 6"
      v-model="search"
      :placeholder="$t('company.search')"
      prepend-inner-icon="search"
      density="compact"
      hide-details
      clearable
      class="select-company__search"
      autofocus
    />

    <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>

    <div v-if="companies.length === 0" class="text-center text-medium-emphasis py-10">
      {{ search ? $t('company.noMatch') : $t('company.none') }}
    </div>

    <div v-else class="select-company__grid">
      <button
        v-for="c in companies"
        :key="c.id"
        type="button"
        class="company-card"
        :class="{ 'company-card--busy': busy === c.id }"
        :disabled="!!busy"
        @click="choose(c)"
      >
        <span class="company-card__code">{{ c.code }}</span>
        <span class="company-card__name">{{ name(c) }}</span>
        <span class="company-card__other">{{ other(c) }}</span>
        <span v-if="counts[c.id]" class="company-card__meta">
          {{ $t('company.employeesCount', { n: counts[c.id]?.employees ?? 0 }) }}
        </span>
        <v-progress-circular v-if="busy === c.id" indeterminate size="18" width="2" class="company-card__spin" />
        <v-icon v-else icon="arrow-right" size="18" class="company-card__arrow flip-rtl" />
      </button>
    </div>

    <div class="text-center mt-8">
      <v-btn variant="text" size="small" prepend-icon="log-out" @click="auth.logout().then(() => router.replace('/login'))">
        {{ $t('login.signOut') }}
      </v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.select-company { max-width: 920px; padding-block: 48px; }
.select-company__head { text-align: center; margin-bottom: 28px; }
.select-company__head .v-icon { margin-bottom: 10px; }
.select-company__title { font-size: 1.625rem; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
.select-company__search { max-width: 420px; margin: 0 auto 20px; }
.select-company__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.company-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 18px 18px 16px;
  border-radius: var(--r-lg);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--app-shadow-card);
  text-align: start;
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition: transform var(--app-duration) var(--app-ease), border-color var(--app-duration) var(--app-ease), box-shadow var(--app-duration) var(--app-ease);
}
.company-card:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: rgba(var(--v-theme-primary), 0.5);
  box-shadow: var(--app-shadow-md);
}
.company-card:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.company-card:disabled { cursor: default; opacity: 0.7; }
.company-card__code {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  padding: 2px 8px;
  border-radius: 999px;
  margin-bottom: 8px;
}
.company-card__name { font-size: 1.05rem; font-weight: 600; }
.company-card__other { font-size: 0.85rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.company-card__meta { margin-top: 10px; font-size: 0.78rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.company-card__arrow, .company-card__spin { position: absolute; inset-inline-end: 16px; top: 18px; opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .company-card { transition: none; } .company-card:hover:not(:disabled) { transform: none; } }
</style>
