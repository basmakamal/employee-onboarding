<script setup lang="ts">
/**
 * Payslips: the automatic sending (on a chosen day each month, the approved
 * run of the month is e-mailed to everyone not sent yet) and manual sending
 * for any approved month — to everyone, one branch / department or one person.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import RunPayslips from '../components/RunPayslips.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';

interface Run { id: string; month: string; status: string; employees: number }
interface Settings { autoSend: boolean; sendDay: number; lastAutoMonth: string | null }

const { t, locale } = useI18n();
const auth = useAuthStore();
const companyName = useActiveCompanyName();
const ar = computed(() => locale.value.startsWith('ar'));
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const runs = ref<Run[]>([]);
const runId = ref<string | null>(null);
const settings = ref<Settings>({ autoSend: false, sendDay: 27, lastAutoMonth: null });
const saving = ref(false);
const saved = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    const [all, s] = await Promise.all([api.get<Run[]>('/api/payroll/runs'), api.get<Settings>('/api/payroll/payslip-settings')]);
    runs.value = all.filter((r) => r.status === 'APPROVED' || r.status === 'PAID');
    runId.value = runs.value[0]?.id ?? null;
    settings.value = s;
  } catch (e) {
    error.value = errorText(e);
  }
});
const run = computed(() => runs.value.find((r) => r.id === runId.value) ?? null);

async function saveSettings() {
  saving.value = true;
  error.value = '';
  try {
    settings.value = await api.put<Settings>('/api/payroll/payslip-settings', { autoSend: settings.value.autoSend, sendDay: Number(settings.value.sendDay) });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
const days = Array.from({ length: 28 }, (_, i) => i + 1);
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('payslips.pageTitle')" :subtitle="$t('payslips.pageSubtitle', { company: companyName })" />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <!-- Automatic sending -->
    <v-card class="mb-4">
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">{{ $t('payslips.autoTitle') }}</v-card-title>
        <v-card-subtitle class="text-wrap">{{ $t('payslips.autoHint') }}</v-card-subtitle>
      </v-card-item>
      <v-card-text class="d-flex flex-wrap align-center ga-4">
        <v-switch v-model="settings.autoSend" :label="$t('payslips.autoOn')" color="primary" hide-details density="compact" :disabled="!auth.can('payroll.manage')" />
        <v-select v-model="settings.sendDay" :items="days" :label="$t('payslips.sendDay')" density="compact" hide-details style="max-width: 160px" :disabled="!settings.autoSend || !auth.can('payroll.manage')" />
        <v-btn v-if="auth.can('payroll.manage')" color="primary" variant="tonal" :loading="saving" @click="saveSettings">{{ saved ? $t('payslips.saved') : $t('common.save') }}</v-btn>
        <span v-if="settings.lastAutoMonth" class="text-caption text-medium-emphasis">{{ $t('payslips.lastAuto', { month: monthLabel(settings.lastAutoMonth) }) }}</span>
      </v-card-text>
    </v-card>

    <!-- Manual sending for a month -->
    <EmptyState v-if="runs.length === 0" icon="file-text" :title="$t('payslips.noRuns')" compact />
    <template v-else>
      <v-select v-model="runId" :items="runs.map((r) => ({ title: `${monthLabel(r.month)} — ${t(`payroll.statuses.${r.status}`)}`, value: r.id }))" :label="$t('payroll.month')" density="compact" hide-details style="max-width: 320px" />
      <RunPayslips v-if="run" :key="run.id" :run-id="run.id" :month="run.month" :can-send="auth.can('payroll.prepare', 'payroll.approve')" />
    </template>
  </v-container>
</template>
