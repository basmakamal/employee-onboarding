<script setup lang="ts">
/**
 * The Leave tab of the employee file: balances per type, the leave taken and
 * waiting, and the balance history (accrual, use, adjustments). Staff enter a
 * leave here — the dialog shows the days, pay and balance after before it is
 * sent — and an approver decides it under Workforce → Leave.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';
import { REQUEST_COLOR, useAttendanceFormat, ymd } from '../composables/useAttendanceFormat';

interface Balance {
  leaveTypeId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  color: string | null;
  balanceMode: 'ACCRUAL' | 'NONE';
  balance: number | null;
  usedThisYear: number;
  pending: number;
  yearlyLimit: number | null;
}
interface PayPart { days: number; percent: number }
interface Req {
  id: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: string;
  status: string;
  reason: string | null;
  payBreakdown: PayPart[] | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledBy: string | null;
  leaveType: { code: string; nameAr: string; nameEn: string; color: string | null };
}
interface Entry { id: string; kind: string; days: string; date: string; note: string | null; createdBy: string | null; leaveType: { code: string; nameAr: string; nameEn: string } }
interface LeaveType { id: string; code: string; nameAr: string; nameEn: string; active: boolean; balanceMode: string; allowHalfDay: boolean }

const props = defineProps<{ employeeId: string; canManage: boolean }>();
const { t } = useI18n();
const confirm = useConfirm();
const f = useAttendanceFormat();

const base = computed(() => `/api/employees/${props.employeeId}/leave`);
const data = ref<{ balances: Balance[]; requests: Req[]; ledger: Entry[] } | null>(null);
const types = ref<LeaveType[]>([]);
const error = ref('');
const nameOf = (x: { nameAr: string; nameEn: string }) => (f.ar.value ? x.nameAr : x.nameEn);
const n = (v: string | number | null | undefined) => (v == null ? '—' : String(Number(v)));

async function load() {
  error.value = '';
  try {
    data.value = await api.get(base.value);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => void load());

const accruing = computed(() => (data.value?.balances ?? []).filter((b) => b.balanceMode === 'ACCRUAL'));
const others = computed(() => (data.value?.balances ?? []).filter((b) => b.balanceMode === 'NONE' && (b.usedThisYear > 0 || b.pending > 0)));
const range = (r: Req) => (r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? f.day(r.startDate, true) : `${f.day(r.startDate)} – ${f.day(r.endDate, true)}`);
const pay = (p: PayPart[] | null) => (p ?? []).map((x) => t('leave.payPart', { days: x.days, percent: x.percent })).join(' · ');

async function loadTypes() {
  if (types.value.length) return;
  types.value = (await api.get<LeaveType[]>('/api/leave/types')).filter((x) => x.active);
}

// ─────────────────────────────────────── add leave
const dialog = ref(false);
const draft = ref({ leaveTypeId: null as string | null, startDate: ymd(new Date()), endDate: ymd(new Date()), halfDay: false, reason: '' });
const form = useForm();
const preview = ref<{ days: number; pay: PayPart[]; balanceAfter: number | null } | null>(null);
const previewError = ref('');
const chosen = computed(() => types.value.find((x) => x.id === draft.value.leaveTypeId) ?? null);
async function openAdd() {
  form.reset();
  try {
    await loadTypes();
  } catch (e) {
    error.value = errorText(e);
    return;
  }
  draft.value = { leaveTypeId: null, startDate: ymd(new Date()), endDate: ymd(new Date()), halfDay: false, reason: '' };
  preview.value = null;
  previewError.value = '';
  dialog.value = true;
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => ({ leaveTypeId: draft.value.leaveTypeId, startDate: draft.value.startDate, endDate: draft.value.endDate, halfDay: draft.value.halfDay }),
  (d) => {
    clearTimeout(timer);
    preview.value = null;
    previewError.value = '';
    if (!dialog.value || !d.leaveTypeId || !d.startDate || !d.endDate) return;
    timer = setTimeout(async () => {
      try {
        preview.value = await api.post(`${base.value}/preview`, { leaveTypeId: d.leaveTypeId, startDate: d.startDate, endDate: d.endDate, halfDay: d.halfDay });
      } catch (e) {
        previewError.value = errorText(e);
      }
    }, 300);
  },
);
watch(() => [draft.value.startDate, draft.value.endDate, chosen.value?.allowHalfDay], () => {
  if (draft.value.startDate !== draft.value.endDate || !chosen.value?.allowHalfDay) draft.value.halfDay = false;
});
function save() {
  return form.submit(async () => {
    const d = draft.value;
    await api.post(`${base.value}/requests`, {
      leaveTypeId: d.leaveTypeId,
      startDate: d.startDate,
      endDate: d.endDate,
      halfDay: d.halfDay,
      ...(d.reason.trim() ? { reason: d.reason.trim() } : {}),
    });
    dialog.value = false;
    await load();
  });
}

async function cancel(r: Req) {
  const msg = r.status === 'APPROVED' ? t('leave.cancelApprovedConfirm') : t('leave.cancelConfirm');
  if (!(await confirm({ title: t('leave.cancel'), message: msg, color: 'error', confirmText: t('leave.cancel') }))) return;
  try {
    await api.post(`${base.value}/requests/${r.id}/cancel`, {});
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

// ─────────────────────────────────────── adjust balance
const adjDialog = ref(false);
const adj = ref({ leaveTypeId: null as string | null, days: 0, date: ymd(new Date()), note: '' });
const adjForm = useForm();
function openAdjust() {
  adjForm.reset();
  adj.value = { leaveTypeId: accruing.value[0]?.leaveTypeId ?? null, days: 0, date: ymd(new Date()), note: '' };
  adjDialog.value = true;
}
function saveAdjust() {
  return adjForm.submit(async () => {
    const a = adj.value;
    await api.post(`${base.value}/adjustments`, { leaveTypeId: a.leaveTypeId, days: Number(a.days), date: a.date, note: a.note.trim() });
    adjDialog.value = false;
    await load();
  });
}
const KIND_COLOR: Record<string, string> = { ACCRUAL: 'success', USE: 'primary', REVERSAL: 'info', ADJUSTMENT: 'warning', EXPIRY: 'error' };
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

  <!-- Balances -->
  <v-card class="mb-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <div class="flex-grow-1">
        <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('leave.balances') }}</h3>
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('leave.balancesHint') }}</p>
      </div>
      <template v-if="canManage">
        <v-btn color="primary" variant="flat" size="small" prepend-icon="calendar-plus" @click="openAdd">{{ $t('leave.add') }}</v-btn>
        <v-btn v-if="accruing.length" variant="tonal" size="small" prepend-icon="pencil" @click="openAdjust">{{ $t('leave.adjust') }}</v-btn>
      </template>
    </div>
    <v-card-text>
      <div v-if="!data" class="py-4 text-center"><v-progress-circular indeterminate color="primary" /></div>
      <div v-else class="bal-grid">
        <div v-for="b in accruing" :key="b.leaveTypeId" class="bal" :style="{ '--c': b.color ?? '#5b3fd1' }">
          <div class="text-caption font-weight-bold bal__name">{{ nameOf(b) }}</div>
          <div class="bal__num">{{ n(b.balance) }}</div>
          <div class="text-caption text-medium-emphasis">{{ $t('leave.daysLeft') }}</div>
          <div class="text-caption mt-1">
            {{ $t('leave.usedThisYear', { n: b.usedThisYear }) }}<template v-if="b.pending"> · <span class="text-warning">{{ $t('leave.waitingN', { n: b.pending }) }}</span></template>
          </div>
        </div>
        <div v-for="b in others" :key="b.leaveTypeId" class="bal bal--light" :style="{ '--c': b.color ?? '#5b3fd1' }">
          <div class="text-caption font-weight-bold bal__name">{{ nameOf(b) }}</div>
          <div class="bal__num bal__num--sm">{{ b.usedThisYear }}<span v-if="b.yearlyLimit" class="text-medium-emphasis"> / {{ b.yearlyLimit }}</span></div>
          <div class="text-caption text-medium-emphasis">{{ $t('leave.takenThisYear') }}</div>
          <div v-if="b.pending" class="text-caption text-warning mt-1">{{ $t('leave.waitingN', { n: b.pending }) }}</div>
        </div>
        <div v-if="accruing.length === 0 && others.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('leave.noBalances') }}</div>
      </div>
    </v-card-text>
  </v-card>

  <!-- Requests -->
  <v-card :title="$t('leave.requests')" class="mb-4">
    <v-card-text>
      <div v-if="data && data.requests.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('leave.noRequests') }}</div>
      <div v-for="r in data?.requests ?? []" :key="r.id" class="d-flex align-center flex-wrap ga-2 py-2 rrow">
        <span class="dot" :style="{ background: r.leaveType.color ?? '#5b3fd1' }" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">
            {{ nameOf(r.leaveType) }} · {{ range(r) }} · {{ $t('leave.nDays', { n: Number(r.days) }) }}<template v-if="r.halfDay"> ({{ $t('leave.halfDay') }})</template>
            <v-chip size="x-small" variant="tonal" :color="REQUEST_COLOR[r.status]" class="ms-1">{{ $t(`attendance.requestStatuses.${r.status}`) }}</v-chip>
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ pay(r.payBreakdown) }}<template v-if="r.reason"> · {{ r.reason }}</template><template v-if="r.requestedBy"> · {{ $t('attendance.enteredBy', { name: r.requestedBy }) }}</template>
          </div>
          <div v-if="r.decidedBy" class="text-caption text-medium-emphasis">
            {{ $t('attendance.decidedBy', { name: r.decidedBy, at: f.stamp(r.decidedAt) }) }}<template v-if="r.decisionNote"> — {{ r.decisionNote }}</template>
          </div>
          <div v-if="r.cancelledBy" class="text-caption text-medium-emphasis">{{ $t('leave.cancelledBy', { name: r.cancelledBy }) }}</div>
        </div>
        <v-btn v-if="canManage && ['PENDING', 'APPROVED'].includes(r.status)" size="small" variant="text" color="error" @click="cancel(r)">{{ $t('leave.cancel') }}</v-btn>
      </div>
    </v-card-text>
  </v-card>

  <!-- Balance history -->
  <v-expansion-panels v-if="data && data.ledger.length" class="mb-4">
    <v-expansion-panel>
      <v-expansion-panel-title>{{ $t('leave.history') }}</v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ $t('attendance.date') }}</th>
              <th>{{ $t('leave.type') }}</th>
              <th>{{ $t('leave.entry') }}</th>
              <th>{{ $t('leave.days') }}</th>
              <th>{{ $t('attendance.note') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in data.ledger" :key="l.id">
              <td class="text-no-wrap">{{ f.day(l.date, true) }}</td>
              <td>{{ nameOf(l.leaveType) }}</td>
              <td><v-chip size="x-small" variant="tonal" :color="KIND_COLOR[l.kind]">{{ $t(`leave.kinds.${l.kind}`) }}</v-chip></td>
              <td><span dir="ltr" :class="Number(l.days) < 0 ? 'text-error' : 'text-success'">{{ Number(l.days) > 0 ? '+' : '' }}{{ Number(l.days) }}</span></td>
              <td class="text-caption">{{ l.note ?? '' }}<template v-if="l.createdBy"> · {{ l.createdBy }}</template></td>
            </tr>
          </tbody>
        </v-table>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>

  <!-- Add leave -->
  <v-dialog v-model="dialog" max-width="520">
    <v-card :title="$t('leave.add')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="form" />
        <v-form :ref="form.bind" @submit.prevent="save">
          <v-select
            v-model="draft.leaveTypeId"
            :items="types.map((x) => ({ title: nameOf(x), value: x.id }))"
            :label="$t('leave.type') + ' *'"
            :rules="[rules.required]"
            :error-messages="form.errorsFor('leaveTypeId')"
          />
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="draft.startDate" type="date" :label="$t('leave.firstDay') + ' *'" :rules="[rules.required, rules.date]" :error-messages="form.errorsFor('startDate')" /></v-col>
            <v-col cols="6"><v-text-field v-model="draft.endDate" type="date" :label="$t('leave.lastDay') + ' *'" :rules="[rules.required, rules.date]" :error-messages="form.errorsFor('endDate')" /></v-col>
          </v-row>
          <v-switch
            v-if="chosen?.allowHalfDay && draft.startDate === draft.endDate"
            v-model="draft.halfDay"
            :label="$t('leave.halfDay')"
            color="primary"
            hide-details
            density="comfortable"
            class="mb-2"
          />
          <v-textarea v-model="draft.reason" :label="$t('attendance.reason')" rows="2" auto-grow :error-messages="form.errorsFor('reason')" />
        </v-form>
        <v-alert v-if="previewError" type="warning" variant="tonal" density="compact">{{ previewError }}</v-alert>
        <v-alert v-else-if="preview" type="info" variant="tonal" density="compact">
          <div class="font-weight-medium">{{ $t('leave.nDays', { n: preview.days }) }}</div>
          <div class="text-caption">{{ pay(preview.pay) }}</div>
          <div v-if="preview.balanceAfter !== null" class="text-caption">{{ $t('leave.balanceAfter', { n: preview.balanceAfter }) }}</div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!!previewError" :loading="form.busy.value" @click="save">{{ $t('attendance.send') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Adjust balance -->
  <v-dialog v-model="adjDialog" max-width="460">
    <v-card :title="$t('leave.adjust')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="adjForm" />
        <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('leave.adjustHint') }}</p>
        <v-form :ref="adjForm.bind" @submit.prevent="saveAdjust">
          <v-select
            v-model="adj.leaveTypeId"
            :items="accruing.map((b) => ({ title: nameOf(b), value: b.leaveTypeId }))"
            :label="$t('leave.type') + ' *'"
            :rules="[rules.required]"
            :error-messages="adjForm.errorsFor('leaveTypeId')"
          />
          <v-row dense>
            <v-col cols="6"><v-text-field v-model.number="adj.days" type="number" step="0.5" :label="$t('leave.daysSigned') + ' *'" :error-messages="adjForm.errorsFor('days')" /></v-col>
            <v-col cols="6"><v-text-field v-model="adj.date" type="date" :label="$t('attendance.date')" :error-messages="adjForm.errorsFor('date')" /></v-col>
          </v-row>
          <v-text-field v-model="adj.note" :label="$t('leave.adjustNote') + ' *'" :rules="[rules.required]" :error-messages="adjForm.errorsFor('note')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="adjDialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="adjForm.busy.value" @click="saveAdjust">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.bal { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-inline-start: 4px solid var(--c); border-radius: 10px; padding: 10px 12px; }
.bal--light { opacity: 0.9; }
.bal__name { color: var(--c); }
.bal__num { font-size: 28px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.bal__num--sm { font-size: 20px; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 10px; }
.rrow + .rrow { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
