<script setup lang="ts">
/**
 * Loans and one-off payments across the company (an approver with a branch:
 * their branches) — what is being repaid and what is left, and the bonuses
 * and deductions of a payroll month. Entering and deciding happen on the
 * employee's Pay tab and in Approvals.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { errorText } from '../validation/errors';
import { REQUEST_COLOR } from '../composables/useAttendanceFormat';

interface Emp { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null }
interface Row {
  id: string; employee: Emp; status: string; amount: number; reason: string;
  kind: string; instalmentCount?: number; startMonth?: string; outstanding?: number; repaid?: number;
  category?: string; month?: string; decidedBy: string | null;
}

const { locale } = useI18n();
const companyName = useActiveCompanyName();
const ar = computed(() => locale.value.startsWith('ar'));
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const thisMonth = new Date().toISOString().slice(0, 7);

const view = ref<'LOANS' | 'PAYMENTS'>('LOANS');
const status = ref<string | null>('APPROVED');
const month = ref(thisMonth);
const rows = ref<Row[]>([]);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ view: view.value });
    if (status.value) params.set('status', status.value);
    if (view.value === 'PAYMENTS' && month.value) params.set('month', month.value);
    rows.value = (await api.get<{ items: Row[] }>(`/api/payroll/money?${params}`)).items;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
watch(view, (v) => (status.value = v === 'LOANS' ? 'APPROVED' : null));
watch([view, status, month], () => void load(), { immediate: true });

const outstandingTotal = computed(() => rows.value.reduce((t, r) => t + (r.outstanding ?? 0), 0));
const paymentTotals = computed(() => ({
  earn: rows.value.filter((r) => r.kind === 'EARNING' && r.status !== 'CANCELLED' && r.status !== 'REJECTED').reduce((t, r) => t + r.amount, 0),
  ded: rows.value.filter((r) => r.kind === 'DEDUCTION' && r.status !== 'CANCELLED' && r.status !== 'REJECTED').reduce((t, r) => t + r.amount, 0),
}));
const LOAN_STATUSES = ['PENDING', 'APPROVED', 'SETTLED', 'REJECTED', 'CANCELLED'];
const PAY_STATUSES = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'];
const COLOR: Record<string, string> = { ...REQUEST_COLOR, SETTLED: 'success', PAID: 'success' };
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('money.pageTitle')" :subtitle="$t('money.pageSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-btn-toggle v-model="view" mandatory density="compact" variant="outlined" color="primary">
        <v-btn value="LOANS" prepend-icon="banknote">{{ $t('money.loans') }}</v-btn>
        <v-btn value="PAYMENTS" prepend-icon="plus">{{ $t('money.payments') }}</v-btn>
      </v-btn-toggle>
      <v-select
        v-model="status"
        :items="(view === 'LOANS' ? LOAN_STATUSES : PAY_STATUSES).map((s) => ({ title: $t(view === 'LOANS' ? `money.loanStatuses.${s}` : `money.paymentStatuses.${s}`), value: s }))"
        :label="$t('attendance.status')"
        density="compact"
        hide-details
        clearable
        style="max-width: 200px"
      />
      <v-text-field v-if="view === 'PAYMENTS'" v-model="month" type="month" :label="$t('money.payrollMonth')" density="compact" hide-details clearable style="max-width: 190px" />
      <v-spacer />
      <span v-if="view === 'LOANS' && rows.length" class="text-body-2">{{ $t('money.outstanding') }}: <b dir="ltr">{{ money(outstandingTotal) }}</b></span>
      <span v-else-if="view === 'PAYMENTS' && rows.length" class="text-body-2">
        <span class="text-success">+<b dir="ltr">{{ money(paymentTotals.earn) }}</b></span> · <span class="text-error">−<b dir="ltr">{{ money(paymentTotals.ded) }}</b></span>
      </span>
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-if="!loading && rows.length === 0" icon="banknote" :title="$t('money.empty')" compact />
      <v-table v-else density="comfortable">
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="py-2">
              <router-link :to="`/employees/${r.employee.id}?tab=pay`" class="font-weight-medium text-decoration-none">{{ r.employee.firstName }} {{ r.employee.lastName }}</router-link>
              <div class="text-caption text-medium-emphasis">{{ r.employee.orgUnit ? (ar ? r.employee.orgUnit.nameAr : r.employee.orgUnit.nameEn) : r.employee.employeeNo }}</div>
            </td>
            <template v-if="view === 'LOANS'">
              <td>{{ $t(`money.kinds.${r.kind}`) }}<div class="text-caption text-medium-emphasis">{{ $t('money.fromMonth', { month: monthLabel(r.startMonth!) }) }}<template v-if="r.kind === 'LOAN'"> · {{ $t('money.overN', { n: r.instalmentCount }) }}</template></div></td>
              <td dir="ltr" class="text-end">{{ money(r.amount) }}</td>
              <td class="text-end"><span class="text-caption text-medium-emphasis">{{ $t('money.outstanding') }}</span><div dir="ltr" class="font-weight-medium">{{ money(r.outstanding ?? 0) }}</div></td>
            </template>
            <template v-else>
              <td>
                <v-icon :icon="r.kind === 'EARNING' ? 'plus' : 'minus'" :color="r.kind === 'EARNING' ? 'success' : 'error'" size="16" />
                {{ $t(`money.categories.${r.category}`) }}
                <div class="text-caption text-medium-emphasis">{{ monthLabel(r.month!) }} · {{ r.reason }}</div>
              </td>
              <td dir="ltr" class="text-end font-weight-medium">{{ money(r.amount) }}</td>
              <td />
            </template>
            <td class="text-end">
              <v-chip size="x-small" variant="tonal" :color="COLOR[r.status]">{{ $t(view === 'LOANS' ? `money.loanStatuses.${r.status}` : `money.paymentStatuses.${r.status}`) }}</v-chip>
              <div v-if="r.decidedBy" class="text-caption text-medium-emphasis">{{ $t('money.decidedByName', { name: r.decidedBy }) }}</div>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </v-container>
</template>
