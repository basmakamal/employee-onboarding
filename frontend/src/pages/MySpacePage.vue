<script setup lang="ts">
/**
 * "My space" — what an employee sees with their own sign-in: their details,
 * their career history and their documents. Everything comes from /api/me,
 * which the server pins to the signed-in employee. Attendance, leave and
 * payslips join this page in later phases.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, getAccessToken } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useListsStore } from '../stores/lists';
import { errorText } from '../validation/errors';
import EmploymentHistory from '../components/EmploymentHistory.vue';

interface Profile {
  id: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  nationalId: string | null;
  iban: string | null;
  hireDate: string | null;
  employmentType: string;
  status: string;
  company: { nameAr: string; nameEn: string } | null;
  orgUnit: { nameAr: string; nameEn: string } | null;
  position: { titleAr: string; titleEn: string } | null;
  manager: string | null;
  contract: { status: string; startDate: string | null; durationMonths: unknown } | null;
}
interface Docs {
  expiry: Array<{ id: string; type: string; expiryDate: string }>;
  onboarding: Array<{ id: string; type: string; label: string | null; uploadedAt: string | null; mimeType: string | null }>;
}

const { t, locale } = useI18n();
const auth = useAuthStore();
const lists = useListsStore();
const tab = ref('overview');
const profile = ref<Profile | null>(null);
const docs = ref<Docs>({ expiry: [], onboarding: [] });
const error = ref('');

const ar = computed(() => locale.value.startsWith('ar'));
const pick = (o: { nameAr?: string; nameEn?: string; titleAr?: string; titleEn?: string } | null) =>
  o ? (ar.value ? (o.nameAr ?? o.titleAr) : (o.nameEn ?? o.titleEn)) ?? '—' : '—';
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
const docColor = (iso: string) => (daysLeft(iso) < 0 ? 'error' : daysLeft(iso) <= 30 ? 'warning' : 'success');

onMounted(async () => {
  try {
    const [p, d] = await Promise.all([api.get<Profile>('/api/me/profile'), api.get<Docs>('/api/me/documents')]);
    profile.value = p;
    docs.value = d;
  } catch (e) {
    error.value = errorText(e);
  }
});

const rows = computed(() => {
  const p = profile.value;
  if (!p) return [];
  return [
    { label: t('mySpace.employeeNo'), value: p.employeeNo ?? '—' },
    { label: t('fields.orgUnit'), value: pick(p.orgUnit) },
    { label: t('fields.position'), value: pick(p.position) },
    { label: t('fields.manager'), value: p.manager ?? '—' },
    { label: t('employees.hireDate'), value: fmtDate(p.hireDate) },
    { label: t('profile.employmentType'), value: t(`profile.types.${p.employmentType}`, p.employmentType) },
    { label: t('fields.email'), value: p.email, ltr: true },
    { label: t('fields.phone'), value: p.phone ?? '—', ltr: true },
    { label: t('fields.nationalId'), value: p.nationalId ?? '—', ltr: true },
    { label: t('mySpace.iban'), value: p.iban ?? '—', ltr: true },
  ];
});

const downloading = ref('');
async function download(doc: Docs['onboarding'][number]) {
  downloading.value = doc.id;
  try {
    const res = await fetch(`/api/me/documents/${doc.id}/file`, { headers: { Authorization: `Bearer ${getAccessToken()}` } });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.label ?? doc.type;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    error.value = t('mySpace.downloadFailed');
  } finally {
    downloading.value = '';
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 980px">
    <div class="d-flex align-center ga-4 mb-6">
      <v-avatar color="primary" variant="tonal" size="56">
        <span class="text-h6 font-weight-bold">{{ (profile?.firstName ?? auth.user?.name ?? '?').slice(0, 1) }}</span>
      </v-avatar>
      <div class="min-w-0">
        <h1 class="text-h5 font-weight-bold mb-0">{{ $t('mySpace.hello', { name: profile?.firstName ?? auth.user?.name ?? '' }) }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          {{ profile ? `${pick(profile.position)} · ${profile.company ? (ar ? profile.company.nameAr : profile.company.nameEn) : ''}` : $t('mySpace.subtitle') }}
        </p>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="overview" prepend-icon="user">{{ $t('mySpace.overview') }}</v-tab>
      <v-tab value="history" prepend-icon="arrow-left-right">{{ $t('history.tab') }}</v-tab>
      <v-tab value="documents" prepend-icon="file-text">{{ $t('mySpace.documents') }}</v-tab>
    </v-tabs>

    <v-window v-model="tab" :touch="false">
      <v-window-item value="overview">
        <v-card>
          <v-card-text>
            <div v-if="!profile" class="py-6 text-center"><v-progress-circular indeterminate color="primary" /></div>
            <dl v-else class="facts">
              <template v-for="r in rows" :key="r.label">
                <dt class="text-medium-emphasis">{{ r.label }}</dt>
                <dd :dir="r.ltr ? 'ltr' : undefined">{{ r.value }}</dd>
              </template>
            </dl>
            <p class="text-caption text-medium-emphasis mt-4 mb-0">{{ $t('mySpace.correctHint') }}</p>
          </v-card-text>
        </v-card>
      </v-window-item>

      <v-window-item value="history">
        <EmploymentHistory v-if="profile && tab === 'history'" :employee-id="profile.id" :can-edit="false" endpoint="/api/me/history" />
      </v-window-item>

      <v-window-item value="documents">
        <v-card class="mb-4" :title="$t('mySpace.expiryDocs')">
          <v-card-text>
            <div v-if="docs.expiry.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('mySpace.noDocs') }}</div>
            <div v-for="d in docs.expiry" :key="d.id" class="d-flex align-center ga-3 py-2 doc-row">
              <v-icon icon="id-card" color="primary" />
              <div class="flex-grow-1">
                <div class="text-body-2 font-weight-medium">{{ lists.label('DOC_TYPE', d.type) ?? d.type }}</div>
                <div class="text-caption text-medium-emphasis">{{ $t('mySpace.expires', { date: fmtDate(d.expiryDate) }) }}</div>
              </div>
              <v-chip size="small" variant="tonal" :color="docColor(d.expiryDate)">
                {{ daysLeft(d.expiryDate) < 0 ? $t('mySpace.expired') : $t('mySpace.daysLeft', { n: daysLeft(d.expiryDate) }) }}
              </v-chip>
            </div>
          </v-card-text>
        </v-card>
        <v-card :title="$t('mySpace.formDocs')">
          <v-card-text>
            <div v-if="docs.onboarding.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('mySpace.noDocs') }}</div>
            <div v-for="d in docs.onboarding" :key="d.id" class="d-flex align-center ga-3 py-2 doc-row">
              <v-icon icon="file-text" color="primary" />
              <div class="flex-grow-1">
                <div class="text-body-2 font-weight-medium">{{ d.label ?? $t(`docTypes.${d.type}`, d.type) }}</div>
                <div class="text-caption text-medium-emphasis">{{ fmtDate(d.uploadedAt) }}</div>
              </div>
              <v-btn size="small" variant="text" prepend-icon="download" :loading="downloading === d.id" @click="download(d)">
                {{ $t('mySpace.download') }}
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-window-item>
    </v-window>
  </v-container>
</template>

<style scoped>
.facts { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 10px 20px; margin: 0; }
.facts dt { font-size: 13px; }
.facts dd { margin: 0; font-weight: 500; }
@media (max-width: 560px) { .facts { grid-template-columns: 1fr; gap: 2px; } .facts dd { margin-bottom: 10px; } }
.doc-row + .doc-row { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
