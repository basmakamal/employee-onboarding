<script setup lang="ts">
/**
 * Payroll runs of the selected company, newest month first. "Calculate"
 * starts a month (or recalculates the open one) and opens it for review.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useForm } from '../composables/useForm';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';

interface Run {
  id: string; month: string; version: number; status: string; employees: number;
  gross: number; deductions: number; net: number; employerCost: number;
  calculatedBy: string | null; calculatedAt: string | null; approvedBy: string | null; approvedAt: string | null; paidAt: string | null;
  warnings: Array<{ code: string; blocking: boolean; count: number }>;
}

const { locale } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const companyName = useActiveCompanyName();
const ar = computed(() => locale.value.startsWith('ar'));
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const RUN_COLOR: Record<string, string> = { CALCULATED: 'warning', APPROVED: 'info', PAID: 'success', CANCELLED: 'grey' };

const runs = ref<Run[]>([]);
const loading = ref(false);
const error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    runs.value = await api.get<Run[]>('/api/payroll/runs');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

const dialog = ref(false);
const month = ref(new Date().toISOString().slice(0, 7));
const form = useForm();
function save() {
  return form.submit(async () => {
    const run = await api.post<{ id: string }>('/api/payroll/runs', { month: month.value });
    dialog.value = false;
    await router.push(`/payroll/runs/${run.id}`);
  });
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('payroll.title')" :subtitle="$t('payroll.subtitle', { company: companyName })">
      <v-btn v-if="auth.can('payroll.prepare')" color="primary" prepend-icon="calendar-plus" @click="form.reset(); dialog = true">{{ $t('payroll.calculate') }}</v-btn>
    </PageHeader>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-if="!loading && runs.length === 0" icon="banknote" :title="$t('payroll.empty')" compact />
      <v-table v-else hover>
        <thead>
          <tr>
            <th>{{ $t('payroll.month') }}</th>
            <th>{{ $t('attendance.status') }}</th>
            <th class="text-end">{{ $t('payroll.people') }}</th>
            <th class="text-end">{{ $t('payroll.gross') }}</th>
            <th class="text-end">{{ $t('payroll.net') }}</th>
            <th>{{ $t('payroll.who') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id" class="cursor-pointer" @click="router.push(`/payroll/runs/${r.id}`)">
            <td class="font-weight-medium">{{ monthLabel(r.month) }}<span v-if="r.version > 1" class="text-caption text-medium-emphasis"> · #{{ r.version }}</span></td>
            <td>
              <v-chip size="small" variant="tonal" :color="RUN_COLOR[r.status]">{{ $t(`payroll.statuses.${r.status}`) }}</v-chip>
              <v-icon v-if="r.status === 'CALCULATED' && r.warnings.some((w) => w.blocking)" icon="triangle-alert" color="error" size="16" class="ms-1" />
            </td>
            <td class="text-end">{{ r.employees }}</td>
            <td class="text-end" dir="ltr">{{ money(r.gross) }}</td>
            <td class="text-end font-weight-medium" dir="ltr">{{ money(r.net) }}</td>
            <td class="text-caption text-medium-emphasis">
              <div v-if="r.calculatedBy">{{ $t('payroll.calculatedBy', { name: r.calculatedBy }) }}</div>
              <div v-if="r.approvedBy">{{ $t('payroll.approvedBy', { name: r.approvedBy }) }}</div>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="420">
      <v-card :title="$t('payroll.calculate')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="form" />
          <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('payroll.calculateHint') }}</p>
          <v-text-field v-model="month" type="month" :label="$t('payroll.month')" :error-messages="form.errorsFor('month')" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="form.busy.value" @click="save">{{ $t('payroll.calculate') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
