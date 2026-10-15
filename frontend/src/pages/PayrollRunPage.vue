<script setup lang="ts">
/**
 * One payroll run: totals, what blocks approval (with where to fix it), and
 * every employee's line with its breakdown and the change from last month.
 * The preparer recalculates, holds people out and hands it over; someone
 * else approves (never the person who calculated it), then marks it paid.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import RunPayslips from '../components/RunPayslips.vue';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';

interface Item { id: string; kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER'; source: string; code: string; labelAr: string; labelEn: string; quantity: number | null; rate: number | null; amount: number }
interface Line {
  id: string;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null };
  gross: number; deductions: number; net: number; employerCost: number; previousNet: number | null;
  held: boolean; heldReason: string | null;
  inputs: { segments?: Array<{ from: string; to: string; factor: number }>; monthWorkingDays?: number; rates?: { daily: number; hourly: number; overtimeHourly: number } };
  warnings: Array<{ code: string; blocking: boolean; detail?: Record<string, number> }>;
  items: Item[];
}
interface Run {
  id: string; month: string; version: number; status: string; periodFrom: string; periodTo: string; engineVersion: string;
  employees: number; gross: number; deductions: number; net: number; employerCost: number;
  warnings: Array<{ code: string; blocking: boolean; count: number }>;
  calculatedById: string | null; calculatedBy: string | null; calculatedAt: string | null;
  approvedBy: string | null; approvedAt: string | null; paidBy: string | null; paidAt: string | null; note: string | null;
  lines: Line[];
}

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const confirm = useConfirm();
const ar = computed(() => locale.value.startsWith('ar'));
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dateLabel = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const RUN_COLOR: Record<string, string> = { CALCULATED: 'warning', APPROVED: 'info', PAID: 'success', CANCELLED: 'grey' };

const id = route.params['id'] as string;
const run = ref<Run | null>(null);
const error = ref('');
const busy = ref('');
const open = ref<string | null>(null);
const q = ref('');
const onlyIssues = ref(false);

async function load() {
  error.value = '';
  try {
    run.value = await api.get<Run>(`/api/payroll/runs/${id}`);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => void load());

const lines = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return (run.value?.lines ?? []).filter(
    (l) =>
      (!needle || `${l.employee.firstName} ${l.employee.lastName} ${l.employee.employeeNo ?? ''}`.toLowerCase().includes(needle)) &&
      (!onlyIssues.value || l.warnings.length > 0 || l.held || (l.previousNet !== null && Math.abs(l.net - l.previousNet) > 0.009)),
  );
});
const blocking = computed(() => (run.value?.warnings ?? []).filter((w) => w.blocking));
const iCalculated = computed(() => !!run.value?.calculatedById && run.value.calculatedById === auth.user?.id);
const canApprove = computed(() => run.value?.status === 'CALCULATED' && auth.can('payroll.approve') && !iCalculated.value && blocking.value.length === 0);
const delta = (l: Line) => (l.previousNet === null ? null : Math.round((l.net - l.previousNet) * 100) / 100);

async function act(kind: 'recalculate' | 'paid' | 'cancel') {
  if (kind === 'cancel' && !(await confirm({ title: t('payroll.cancelRun'), message: t('payroll.cancelConfirm'), color: 'error', confirmText: t('payroll.cancelRun') }))) return;
  if (kind === 'paid' && !(await confirm({ title: t('payroll.markPaid'), message: t('payroll.markPaidConfirm'), confirmText: t('payroll.markPaid') }))) return;
  busy.value = kind;
  error.value = '';
  try {
    if (kind === 'cancel') {
      await api.post(`/api/payroll/runs/${id}/cancel`, {});
      await router.push('/payroll/runs');
      return;
    }
    run.value = await api.post<Run>(`/api/payroll/runs/${id}/${kind}`, {});
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = '';
  }
}

// ─────────────────────────────────────── approve
const approveDialog = ref({ show: false, note: '' });
const approveForm = useForm();
function saveApprove() {
  return approveForm.submit(async () => {
    run.value = await api.post<Run>(`/api/payroll/runs/${id}/approve`, approveDialog.value.note.trim() ? { note: approveDialog.value.note.trim() } : {});
    approveDialog.value.show = false;
  });
}

// ─────────────────────────────────────── hold
const holdDialog = ref({ show: false, line: null as Line | null, reason: '' });
const holdForm = useForm();
async function toggleHold(l: Line) {
  if (l.held) {
    try {
      run.value = await api.post<Run>(`/api/payroll/runs/${id}/lines/${l.id}/hold`, { held: false });
    } catch (e) {
      error.value = errorText(e);
    }
    return;
  }
  holdForm.reset();
  holdDialog.value = { show: true, line: l, reason: '' };
}
function saveHold() {
  return holdForm.submit(async () => {
    run.value = await api.post<Run>(`/api/payroll/runs/${id}/lines/${holdDialog.value.line!.id}/hold`, { held: true, reason: holdDialog.value.reason.trim() });
    holdDialog.value.show = false;
  });
}
const FIX_LINK: Record<string, string> = { EXCEPTIONS_PENDING: '/workforce/attendance', GOSI_RATES_MISSING: '/payroll/setup' };
</script>

<template>
  <v-container class="py-8" fluid style="max-width: 1300px">
    <PageHeader v-if="run" :title="$t('payroll.runTitle', { month: monthLabel(run.month) })" :subtitle="$t('payroll.period', { from: dateLabel(run.periodFrom), to: dateLabel(run.periodTo) })">
      <v-chip :color="RUN_COLOR[run.status]" variant="tonal" class="me-2">{{ $t(`payroll.statuses.${run.status}`) }}</v-chip>
      <template v-if="run.status === 'CALCULATED'">
        <v-btn v-if="auth.can('payroll.prepare')" variant="tonal" prepend-icon="refresh-cw" :loading="busy === 'recalculate'" @click="act('recalculate')">{{ $t('payroll.recalculate') }}</v-btn>
        <v-btn v-if="auth.can('payroll.approve')" color="success" variant="flat" prepend-icon="check" :disabled="!canApprove" @click="approveForm.reset(); approveDialog = { show: true, note: '' }">{{ $t('payroll.approve') }}</v-btn>
        <v-btn v-if="auth.can('payroll.prepare')" variant="text" color="error" :loading="busy === 'cancel'" @click="act('cancel')">{{ $t('payroll.cancelRun') }}</v-btn>
      </template>
      <v-btn v-if="run.status === 'APPROVED' && auth.can('payroll.approve', 'payroll.prepare')" color="primary" variant="flat" prepend-icon="banknote" :loading="busy === 'paid'" @click="act('paid')">{{ $t('payroll.markPaid') }}</v-btn>
    </PageHeader>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <div v-if="!run && !error" class="py-12 text-center"><v-progress-circular indeterminate color="primary" /></div>

    <template v-if="run">
      <!-- Totals -->
      <div class="totals mb-4">
        <v-card variant="tonal" class="pa-3"><div class="text-caption">{{ $t('payroll.people') }}</div><div class="tot">{{ run.employees }}</div></v-card>
        <v-card variant="tonal" class="pa-3"><div class="text-caption">{{ $t('payroll.gross') }}</div><div class="tot" dir="ltr">{{ money(run.gross) }}</div></v-card>
        <v-card variant="tonal" class="pa-3"><div class="text-caption">{{ $t('payroll.deductions') }}</div><div class="tot" dir="ltr">{{ money(run.deductions) }}</div></v-card>
        <v-card variant="tonal" color="primary" class="pa-3"><div class="text-caption">{{ $t('payroll.net') }}</div><div class="tot" dir="ltr">{{ money(run.net) }}</div></v-card>
        <v-card variant="tonal" class="pa-3"><div class="text-caption">{{ $t('payroll.employerCost') }}</div><div class="tot" dir="ltr">{{ money(run.employerCost) }}</div></v-card>
      </div>

      <!-- Who did what -->
      <p class="text-caption text-medium-emphasis mb-3">
        <template v-if="run.calculatedBy">{{ $t('payroll.calculatedByAt', { name: run.calculatedBy, at: stamp(run.calculatedAt) }) }}</template>
        <template v-if="run.approvedBy"> · {{ $t('payroll.approvedByAt', { name: run.approvedBy, at: stamp(run.approvedAt) }) }}</template>
        <template v-if="run.paidBy"> · {{ $t('payroll.paidByAt', { name: run.paidBy, at: stamp(run.paidAt) }) }}</template>
        <template v-if="run.note"> — {{ run.note }}</template>
      </p>

      <!-- What needs attention -->
      <v-alert v-if="run.status === 'CALCULATED' && iCalculated && auth.can('payroll.approve')" type="info" variant="tonal" density="compact" class="mb-3">{{ $t('payroll.notYours') }}</v-alert>
      <v-alert v-for="w in run.warnings" :key="w.code" :type="w.blocking ? 'error' : 'warning'" variant="tonal" density="compact" class="mb-2">
        <div class="d-flex align-center flex-wrap ga-2">
          <span class="flex-grow-1">{{ $t(`payroll.warnings.${w.code}`, { n: w.count }) }}</span>
          <v-btn v-if="FIX_LINK[w.code]" size="small" variant="text" :to="FIX_LINK[w.code]">{{ $t('payroll.fix') }}</v-btn>
        </div>
      </v-alert>

      <!-- Lines -->
      <v-card class="mt-4">
        <div class="d-flex flex-wrap align-center ga-3 px-4 pt-3">
          <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 260px" />
          <v-switch v-model="onlyIssues" :label="$t('payroll.onlyIssues')" color="primary" density="compact" hide-details />
        </div>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('fields.name') }}</th>
              <th class="text-end">{{ $t('payroll.gross') }}</th>
              <th class="text-end">{{ $t('payroll.deductions') }}</th>
              <th class="text-end">{{ $t('payroll.net') }}</th>
              <th class="text-end">{{ $t('payroll.vsLast') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="l in lines" :key="l.id">
              <tr class="cursor-pointer" :class="{ 'text-disabled': l.held }" @click="open = open === l.id ? null : l.id">
                <td class="py-2">
                  <div class="font-weight-medium">{{ l.employee.firstName }} {{ l.employee.lastName }}</div>
                  <div class="text-caption text-medium-emphasis">{{ l.employee.employeeNo ?? '' }}<template v-if="l.employee.orgUnit"> · {{ ar ? l.employee.orgUnit.nameAr : l.employee.orgUnit.nameEn }}</template></div>
                  <div class="d-flex flex-wrap ga-1 mt-1">
                    <v-chip v-if="l.held" size="x-small" color="grey" variant="flat">{{ $t('payroll.held') }}</v-chip>
                    <v-chip v-for="w in l.warnings" :key="w.code" size="x-small" variant="tonal" :color="w.blocking ? 'error' : 'warning'">{{ $t(`payroll.lineWarnings.${w.code}`) }}</v-chip>
                  </div>
                </td>
                <td class="text-end" dir="ltr">{{ money(l.gross) }}</td>
                <td class="text-end" dir="ltr">{{ money(l.deductions) }}</td>
                <td class="text-end font-weight-bold" dir="ltr">{{ money(l.net) }}</td>
                <td class="text-end" dir="ltr">
                  <span v-if="delta(l) === null" class="text-medium-emphasis">{{ $t('payroll.new') }}</span>
                  <span v-else-if="delta(l) === 0" class="text-medium-emphasis">—</span>
                  <span v-else :class="delta(l)! > 0 ? 'text-success' : 'text-error'">{{ delta(l)! > 0 ? '+' : '' }}{{ money(delta(l)!) }}</span>
                </td>
                <td class="text-end">
                  <v-btn v-if="run.status === 'CALCULATED' && auth.can('payroll.prepare')" size="x-small" variant="text" @click.stop="toggleHold(l)">{{ l.held ? $t('payroll.release') : $t('payroll.hold') }}</v-btn>
                  <v-icon :icon="open === l.id ? 'chevron-up' : 'chevron-down'" size="18" />
                </td>
              </tr>
              <tr v-if="open === l.id" class="detail">
                <td colspan="6" class="pa-4">
                  <div v-if="l.heldReason" class="text-caption mb-2">{{ $t('payroll.heldBecause', { reason: l.heldReason }) }}</div>
                  <v-table density="compact" class="items">
                    <tbody>
                      <tr v-for="i in l.items" :key="i.id">
                        <td>
                          {{ ar ? i.labelAr : i.labelEn }}
                          <span v-if="i.quantity !== null" class="text-caption text-medium-emphasis" dir="ltr"> ({{ i.quantity }}<template v-if="i.rate !== null"> × {{ money(i.rate) }}</template>)</span>
                          <span v-else-if="i.source === 'GOSI' && i.rate !== null" class="text-caption text-medium-emphasis"> ({{ i.rate }}%)</span>
                        </td>
                        <td class="text-end" dir="ltr" :class="{ 'text-error': i.kind === 'DEDUCTION', 'text-medium-emphasis': i.kind === 'EMPLOYER' }">
                          {{ i.kind === 'DEDUCTION' ? '−' : '' }}{{ money(i.amount) }}<span v-if="i.kind === 'EMPLOYER'" class="text-caption"> *</span>
                        </td>
                      </tr>
                    </tbody>
                  </v-table>
                  <div class="text-caption text-medium-emphasis mt-2">
                    <template v-if="l.inputs.segments?.length">{{ $t('payroll.paidDays', { days: l.inputs.segments.map((s) => `${dateLabel(s.from)}–${dateLabel(s.to)}`).join(', ') }) }}</template>
                    <template v-if="l.inputs.rates"> · {{ $t('payroll.rates', { daily: money(l.inputs.rates.daily), hourly: money(l.inputs.rates.hourly), ot: money(l.inputs.rates.overtimeHourly) }) }}</template>
                    <template v-if="l.items.some((i) => i.kind === 'EMPLOYER')"> · * {{ $t('payroll.employerNote') }}</template>
                  </div>
                  <router-link :to="`/employees/${l.employee.id}?tab=pay`" class="text-caption">{{ $t('payroll.openFile') }}</router-link>
                </td>
              </tr>
            </template>
          </tbody>
        </v-table>
      </v-card>
      <p class="text-caption text-medium-emphasis mt-2">{{ $t('payroll.engine', { v: run.engineVersion }) }}</p>

      <!-- Payslips, once approved -->
      <RunPayslips v-if="run.status === 'APPROVED' || run.status === 'PAID'" :run-id="run.id" :month="run.month" :can-send="auth.can('payroll.prepare', 'payroll.approve')" />
    </template>

    <v-dialog v-model="approveDialog.show" max-width="460">
      <v-card :title="$t('payroll.approve')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="approveForm" />
          <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('payroll.approveHint', { n: run?.employees ?? 0, net: money(run?.net ?? 0) }) }}</p>
          <v-textarea v-model="approveDialog.note" :label="$t('attendance.note')" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="approveDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="success" variant="flat" :loading="approveForm.busy.value" @click="saveApprove">{{ $t('payroll.approve') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="holdDialog.show" max-width="440">
      <v-card :title="$t('payroll.hold')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="holdForm" />
          <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('payroll.holdHint') }}</p>
          <v-text-field v-model="holdDialog.reason" :label="$t('attendance.reason') + ' *'" :error-messages="holdForm.errorsFor('reason')" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="holdDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="holdForm.busy.value" @click="saveHold">{{ $t('payroll.hold') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.totals { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.tot { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.detail td { background: rgba(var(--v-theme-on-surface), 0.03); }
.items { max-width: 560px; background: transparent; }
</style>
