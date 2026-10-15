<script setup lang="ts">
/**
 * Advances, loans and one-off payments on the Pay tab. HR / payroll enter
 * them (a loan shows its schedule and the Art. 92 check before it is sent),
 * an approver decides in Approvals, and payroll takes the approved ones into
 * the month. A loan being repaid can skip a month or be settled in cash.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';
import { REQUEST_COLOR } from '../composables/useAttendanceFormat';

interface Instalment { id: string; seq: number; month: string; amount: number; status: string; note: string | null }
interface Loan {
  id: string; kind: 'ADVANCE' | 'LOAN'; amount: number; instalmentCount: number; startMonth: string; reason: string; status: string;
  outstanding: number; repaid: number; instalments: Instalment[]; requestedBy: string | null; decidedBy: string | null; decisionNote: string | null; createdAt: string;
}
interface Payment { id: string; kind: 'EARNING' | 'DEDUCTION'; category: string; amount: number; month: string; reason: string; status: string; requestedBy: string | null; decidedBy: string | null; decisionNote: string | null }
interface Preview { schedule: Array<{ seq: number; month: string; amount: number }>; gross: number; maxPct: number | null; limit: number | null; monthlyTotal: number; withinLimit: boolean }

const props = defineProps<{ employeeId: string; canEdit: boolean }>();
const { t, locale } = useI18n();
const confirm = useConfirm();
const ar = computed(() => locale.value.startsWith('ar'));
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const base = computed(() => `/api/employees/${props.employeeId}`);
const data = ref<{ thisMonth: string; loans: Loan[]; payments: Payment[] } | null>(null);
const error = ref('');
const open = ref<string | null>(null);

async function load() {
  error.value = '';
  try {
    data.value = await api.get(`${base.value}/loans`);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => void load());
const LOAN_COLOR: Record<string, string> = { ...REQUEST_COLOR, SETTLED: 'success' };
const INST_COLOR: Record<string, string> = { DUE: 'warning', DEDUCTED: 'success', PAID_CASH: 'success', POSTPONED: 'grey' };

// ─────────────────────────────────────── new loan / advance
const loanDialog = ref(false);
const loan = ref({ kind: 'LOAN' as 'ADVANCE' | 'LOAN', amount: '' as string | number, instalments: 6, startMonth: '', reason: '' });
const loanForm = useForm();
const preview = ref<Preview | null>(null);
const previewError = ref('');
function openLoan() {
  loanForm.reset();
  loan.value = { kind: 'LOAN', amount: '', instalments: 6, startMonth: data.value?.thisMonth ?? '', reason: '' };
  preview.value = null;
  previewError.value = '';
  loanDialog.value = true;
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => ({ kind: loan.value.kind, amount: loan.value.amount, instalments: loan.value.instalments, startMonth: loan.value.startMonth }),
  (l) => {
    clearTimeout(timer);
    preview.value = null;
    previewError.value = '';
    if (!loanDialog.value || !Number(l.amount) || !l.startMonth) return;
    timer = setTimeout(async () => {
      try {
        preview.value = await api.post(`${base.value}/loans/preview`, { kind: l.kind, amount: Number(l.amount), instalments: Number(l.instalments) || 1, startMonth: l.startMonth, reason: 'preview' });
      } catch (e) {
        previewError.value = errorText(e);
      }
    }, 300);
  },
);
function saveLoan() {
  return loanForm.submit(async () => {
    const l = loan.value;
    await api.post(`${base.value}/loans`, { kind: l.kind, amount: Number(l.amount), instalments: l.kind === 'ADVANCE' ? 1 : Number(l.instalments), startMonth: l.startMonth, reason: l.reason.trim() });
    loanDialog.value = false;
    await load();
  });
}

async function cancelLoan(l: Loan) {
  if (!(await confirm({ title: t('money.cancelLoan'), message: t('money.cancelLoanConfirm'), color: 'error', confirmText: t('money.cancelLoan') }))) return;
  try {
    await api.post(`${base.value}/loans/${l.id}/cancel`, {});
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function postpone(l: Loan, i: Instalment) {
  if (!(await confirm({ title: t('money.postpone'), message: t('money.postponeConfirm', { month: monthLabel(i.month) }), confirmText: t('money.postpone') }))) return;
  try {
    await api.post(`${base.value}/loans/${l.id}/instalments/${i.id}/postpone`, {});
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
const settleDialog = ref({ show: false, loan: null as Loan | null, note: '' });
const settleForm = useForm();
function openSettle(l: Loan) {
  settleForm.reset();
  settleDialog.value = { show: true, loan: l, note: '' };
}
function saveSettle() {
  return settleForm.submit(async () => {
    await api.post(`${base.value}/loans/${settleDialog.value.loan!.id}/settle`, { note: settleDialog.value.note.trim() });
    settleDialog.value.show = false;
    await load();
  });
}

// ─────────────────────────────────────── one-off payment
const CATS = { EARNING: ['BONUS', 'COMMISSION', 'ARREARS', 'OTHER_EARNING'], DEDUCTION: ['PENALTY', 'DAMAGE', 'OTHER_DEDUCTION'] } as const;
const payDialog = ref(false);
const pay = ref({ kind: 'EARNING' as 'EARNING' | 'DEDUCTION', category: 'BONUS', amount: '' as string | number, month: '', reason: '' });
const payForm = useForm();
function openPayment(kind: 'EARNING' | 'DEDUCTION') {
  payForm.reset();
  pay.value = { kind, category: CATS[kind][0], amount: '', month: data.value?.thisMonth ?? '', reason: '' };
  payDialog.value = true;
}
watch(() => pay.value.kind, (k) => (pay.value.category = CATS[k][0]));
function savePayment() {
  return payForm.submit(async () => {
    const p = pay.value;
    await api.post(`${base.value}/payments`, { kind: p.kind, category: p.category, amount: Number(p.amount), month: p.month, reason: p.reason.trim() });
    payDialog.value = false;
    await load();
  });
}
async function cancelPayment(p: Payment) {
  if (!(await confirm({ title: t('money.cancelPayment'), message: t('money.cancelPaymentConfirm'), color: 'error', confirmText: t('money.cancelPayment') }))) return;
  try {
    await api.post(`${base.value}/payments/${p.id}/cancel`, {});
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

  <!-- Loans and advances -->
  <v-card class="mb-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-0 flex-grow-1">{{ $t('money.loans') }}</h3>
      <v-btn v-if="canEdit" variant="tonal" color="primary" size="small" prepend-icon="banknote" @click="openLoan">{{ $t('money.newLoan') }}</v-btn>
    </div>
    <v-card-text>
      <div v-if="data && data.loans.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('money.noLoans') }}</div>
      <div v-for="l in data?.loans ?? []" :key="l.id" class="py-2 lrow">
        <div class="d-flex align-center flex-wrap ga-2">
          <div class="flex-grow-1 min-w-0">
            <div class="text-body-2 font-weight-medium">
              {{ $t(`money.kinds.${l.kind}`) }} · <span dir="ltr">{{ money(l.amount) }}</span>
              <template v-if="l.kind === 'LOAN'"> · {{ $t('money.overN', { n: l.instalmentCount }) }}</template>
              · {{ $t('money.fromMonth', { month: monthLabel(l.startMonth) }) }}
              <v-chip size="x-small" variant="tonal" :color="LOAN_COLOR[l.status]" class="ms-1">{{ $t(`money.loanStatuses.${l.status}`) }}</v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              <template v-if="l.status === 'APPROVED' || l.status === 'SETTLED'">{{ $t('money.repaidOutstanding', { repaid: money(l.repaid), left: money(l.outstanding) }) }} · </template>
              {{ l.reason }}<template v-if="l.requestedBy"> · {{ $t('attendance.enteredBy', { name: l.requestedBy }) }}</template><template v-if="l.decidedBy"> · {{ $t('money.decidedByName', { name: l.decidedBy }) }}</template>
            </div>
          </div>
          <v-btn v-if="l.instalments.length" size="small" variant="text" @click="open = open === l.id ? null : l.id">{{ open === l.id ? $t('money.hideSchedule') : $t('money.schedule') }}</v-btn>
          <template v-if="canEdit">
            <v-btn v-if="l.status === 'APPROVED'" size="small" variant="text" @click="openSettle(l)">{{ $t('money.settle') }}</v-btn>
            <v-btn v-if="['PENDING', 'APPROVED'].includes(l.status) && !l.instalments.some((i) => i.status === 'DEDUCTED' || i.status === 'PAID_CASH')" size="small" variant="text" color="error" @click="cancelLoan(l)">{{ $t('money.cancelLoan') }}</v-btn>
          </template>
        </div>
        <v-expand-transition>
          <v-table v-if="open === l.id" density="compact" class="mt-2">
            <tbody>
              <tr v-for="i in l.instalments" :key="i.id">
                <td>{{ i.seq }}</td>
                <td>{{ monthLabel(i.month) }}</td>
                <td><span dir="ltr">{{ money(i.amount) }}</span></td>
                <td><v-chip size="x-small" variant="tonal" :color="INST_COLOR[i.status]">{{ $t(`money.instStatuses.${i.status}`) }}</v-chip> <span class="text-caption text-medium-emphasis">{{ i.note ?? '' }}</span></td>
                <td class="text-end">
                  <v-btn v-if="canEdit && l.status === 'APPROVED' && i.status === 'DUE' && i.month >= (data?.thisMonth ?? '')" size="x-small" variant="text" @click="postpone(l, i)">{{ $t('money.postpone') }}</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-expand-transition>
      </div>
    </v-card-text>
  </v-card>

  <!-- One-off payments -->
  <v-card class="mb-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-0 flex-grow-1">{{ $t('money.payments') }}</h3>
      <template v-if="canEdit">
        <v-btn variant="tonal" color="success" size="small" prepend-icon="plus" @click="openPayment('EARNING')">{{ $t('money.addEarning') }}</v-btn>
        <v-btn variant="tonal" color="error" size="small" prepend-icon="minus" @click="openPayment('DEDUCTION')">{{ $t('money.addDeduction') }}</v-btn>
      </template>
    </div>
    <v-card-text>
      <div v-if="data && data.payments.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('money.noPayments') }}</div>
      <div v-for="p in data?.payments ?? []" :key="p.id" class="d-flex align-center flex-wrap ga-2 py-2 lrow">
        <v-icon :icon="p.kind === 'EARNING' ? 'plus' : 'minus'" :color="p.kind === 'EARNING' ? 'success' : 'error'" size="18" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">
            {{ $t(`money.categories.${p.category}`) }} · <span dir="ltr">{{ money(p.amount) }}</span> · {{ monthLabel(p.month) }}
            <v-chip size="x-small" variant="tonal" :color="LOAN_COLOR[p.status] ?? 'success'" class="ms-1">{{ $t(`money.paymentStatuses.${p.status}`) }}</v-chip>
          </div>
          <div class="text-caption text-medium-emphasis">{{ p.reason }}<template v-if="p.decidedBy"> · {{ $t('money.decidedByName', { name: p.decidedBy }) }}</template></div>
        </div>
        <v-btn v-if="canEdit && ['PENDING', 'APPROVED'].includes(p.status)" size="small" variant="text" color="error" @click="cancelPayment(p)">{{ $t('money.cancelPayment') }}</v-btn>
      </div>
    </v-card-text>
  </v-card>

  <!-- New loan dialog -->
  <v-dialog v-model="loanDialog" max-width="520">
    <v-card :title="$t('money.newLoan')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="loanForm" />
        <v-form :ref="loanForm.bind" @submit.prevent="saveLoan">
          <v-btn-toggle v-model="loan.kind" mandatory density="compact" variant="outlined" color="primary" class="mb-3">
            <v-btn value="LOAN">{{ $t('money.kinds.LOAN') }}</v-btn>
            <v-btn value="ADVANCE">{{ $t('money.kinds.ADVANCE') }}</v-btn>
          </v-btn-toggle>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="loan.amount" type="number" min="0" suffix="SAR" :label="$t('money.amount') + ' *'" :rules="[rules.required]" :error-messages="loanForm.errorsFor('amount')" /></v-col>
            <v-col v-if="loan.kind === 'LOAN'" cols="6"><v-text-field v-model="loan.instalments" type="number" min="1" max="60" :label="$t('money.instalments')" :error-messages="loanForm.errorsFor('instalments')" /></v-col>
            <v-col cols="6"><v-text-field v-model="loan.startMonth" type="month" :label="$t('money.firstMonth') + ' *'" :rules="[rules.required]" :error-messages="loanForm.errorsFor('startMonth')" /></v-col>
          </v-row>
          <v-textarea v-model="loan.reason" :label="$t('attendance.reason') + ' *'" rows="2" auto-grow :rules="[rules.required]" :error-messages="loanForm.errorsFor('reason')" />
        </v-form>
        <v-alert v-if="previewError" type="warning" variant="tonal" density="compact">{{ previewError }}</v-alert>
        <v-alert v-else-if="preview" :type="preview.withinLimit ? 'info' : 'warning'" variant="tonal" density="compact">
          <div class="font-weight-medium">{{ $t('money.monthly', { n: money(preview.schedule[0]?.amount ?? 0), count: preview.schedule.length }) }}</div>
          <div v-if="preview.limit !== null" class="text-caption">{{ $t('money.limitLine', { pct: preview.maxPct, limit: money(preview.limit), total: money(preview.monthlyTotal) }) }}</div>
          <div v-if="!preview.withinLimit" class="text-caption font-weight-bold">{{ $t('money.overLimit') }}</div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="loanDialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!!previewError || (preview !== null && !preview.withinLimit)" :loading="loanForm.busy.value" @click="saveLoan">{{ $t('attendance.send') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- One-off payment dialog -->
  <v-dialog v-model="payDialog" max-width="480">
    <v-card :title="pay.kind === 'EARNING' ? $t('money.addEarning') : $t('money.addDeduction')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="payForm" />
        <v-form :ref="payForm.bind" @submit.prevent="savePayment">
          <v-select v-model="pay.category" :items="CATS[pay.kind].map((c) => ({ title: $t(`money.categories.${c}`), value: c }))" :label="$t('money.category')" :error-messages="payForm.errorsFor('category')" />
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="pay.amount" type="number" min="0" suffix="SAR" :label="$t('money.amount') + ' *'" :rules="[rules.required]" :error-messages="payForm.errorsFor('amount')" /></v-col>
            <v-col cols="6"><v-text-field v-model="pay.month" type="month" :label="$t('money.payrollMonth') + ' *'" :rules="[rules.required]" :error-messages="payForm.errorsFor('month')" /></v-col>
          </v-row>
          <v-textarea v-model="pay.reason" :label="$t('attendance.reason') + ' *'" rows="2" auto-grow :rules="[rules.required]" :error-messages="payForm.errorsFor('reason')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="payDialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="payForm.busy.value" @click="savePayment">{{ $t('attendance.send') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Settle dialog -->
  <v-dialog v-model="settleDialog.show" max-width="440">
    <v-card :title="$t('money.settle')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="settleForm" />
        <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('money.settleHint', { left: money(settleDialog.loan?.outstanding ?? 0) }) }}</p>
        <v-form :ref="settleForm.bind" @submit.prevent="saveSettle">
          <v-text-field v-model="settleDialog.note" :label="$t('money.settleNote') + ' *'" :rules="[rules.required]" :error-messages="settleForm.errorsFor('note')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="settleDialog.show = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="settleForm.busy.value" @click="saveSettle">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.lrow + .lrow { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
