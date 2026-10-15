<script setup lang="ts">
/**
 * The Attendance tab of the employee file, month by month: the judged days,
 * the punches behind them (who entered each one, and why), and overtime
 * waiting for approval. Staff record the in / out times here — employees do
 * not use the platform — until a biometric device feeds the same record.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';
import { REQUEST_COLOR, REVIEW_COLOR, STATUS_COLOR, useAttendanceFormat, ymd, type AttendanceDayRow } from '../composables/useAttendanceFormat';

interface Punch { id: string; kind: 'IN' | 'OUT'; at: string; source: string; note: string | null; createdBy: string | null }
interface Overtime {
  id: string;
  date: string;
  status: string;
  minutes: number;
  approvedMinutes: number | null;
  reason: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}
interface Period {
  timezone: string;
  days: AttendanceDayRow[];
  events: Punch[];
  overtime: Overtime[];
}

const props = defineProps<{ employeeId: string; canRecord: boolean; canRequestOvertime: boolean }>();
const { t } = useI18n();
const confirm = useConfirm();
const f = useAttendanceFormat();

const base = computed(() => `/api/employees/${props.employeeId}/attendance`);
const month = ref(ymd(new Date()).slice(0, 7));
const period = ref<Period | null>(null);
const error = ref('');
const loading = ref(false);
const tz = computed(() => period.value?.timezone ?? 'Asia/Riyadh');

const monthRange = computed(() => {
  const [y, m] = month.value.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month.value}-01`, to: `${month.value}-${String(last).padStart(2, '0')}` };
});
const monthLabel = computed(() =>
  new Date(`${month.value}-01T00:00:00Z`).toLocaleDateString(f.ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }),
);
function moveMonth(n: number) {
  const [y, m] = month.value.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  month.value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  void load();
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    period.value = await api.get<Period>(`${base.value}?from=${monthRange.value.from}&to=${monthRange.value.to}`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());

/** Punches newest first, each with its local date for grouping by eye. */
const punches = computed(() => [...(period.value?.events ?? [])].reverse());

// ─────────────────────────────────────── record in / out
const recDialog = ref(false);
const rec = ref({ date: '', inTime: '', outTime: '', note: '' });
const recForm = useForm();
function openRecord(date?: string) {
  recForm.reset();
  rec.value = { date: date ?? ymd(new Date()), inTime: '', outTime: '', note: '' };
  recDialog.value = true;
}
function saveRecord() {
  return recForm.submit(async () => {
    const r = rec.value;
    await api.post(`${base.value}/punches`, {
      date: r.date,
      ...(r.inTime ? { inTime: r.inTime } : {}),
      ...(r.outTime ? { outTime: r.outTime } : {}),
      ...(r.note.trim() ? { note: r.note.trim() } : {}),
    });
    recDialog.value = false;
    await load();
  });
}
async function removePunch(p: Punch) {
  if (!(await confirm({ title: t('attendance.deletePunch'), message: t('attendance.deletePunchConfirm'), color: 'error', confirmText: t('attendance.deletePunch') }))) return;
  try {
    await api.delete(`${base.value}/punches/${p.id}`);
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

// ─────────────────────────────────────── overtime
const otDialog = ref(false);
const ot = ref({ date: '', hours: 1, mins: 0, reason: '' });
const otForm = useForm();
function openOvertime(date?: string, minutes?: number) {
  otForm.reset();
  ot.value = { date: date ?? ymd(new Date()), hours: minutes ? Math.floor(minutes / 60) : 1, mins: minutes ? minutes % 60 : 0, reason: '' };
  otDialog.value = true;
}
function saveOvertime() {
  return otForm.submit(async () => {
    const o = ot.value;
    await api.post(`${base.value}/overtime`, { date: o.date, minutes: Number(o.hours) * 60 + Number(o.mins), reason: o.reason.trim() });
    otDialog.value = false;
    await load();
  });
}
async function withdraw(o: Overtime) {
  if (!(await confirm({ title: t('attendance.withdraw'), message: t('attendance.withdrawConfirm'), color: 'error', confirmText: t('attendance.withdraw') }))) return;
  try {
    await api.delete(`${base.value}/overtime/${o.id}`);
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
const fixable = (d: AttendanceDayRow) => !d.locked && ['ABSENT', 'INCOMPLETE'].includes(d.status);
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

  <!-- Days of the month -->
  <v-card class="mb-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <div class="flex-grow-1">
        <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('attendance.daysTitle') }}</h3>
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('attendance.daysHint') }}</p>
      </div>
      <v-btn icon="chevron-left" variant="text" size="small" class="flip-rtl" :aria-label="$t('schedule.earlier')" @click="moveMonth(-1)" />
      <span class="text-body-2 font-weight-medium">{{ monthLabel }}</span>
      <v-btn icon="chevron-right" variant="text" size="small" class="flip-rtl" :aria-label="$t('schedule.later')" @click="moveMonth(1)" />
      <v-btn v-if="canRecord" variant="flat" color="primary" size="small" prepend-icon="clock" @click="openRecord()">{{ $t('attendance.record') }}</v-btn>
      <v-btn v-if="canRequestOvertime" variant="tonal" size="small" prepend-icon="timer" @click="openOvertime()">{{ $t('attendance.addOvertime') }}</v-btn>
    </div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mt-2" />
    <v-card-text>
      <div v-if="period && period.days.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('attendance.noDays') }}</div>
      <v-table v-else-if="period" density="compact" class="att-table">
        <thead>
          <tr>
            <th>{{ $t('attendance.date') }}</th>
            <th>{{ $t('attendance.shift') }}</th>
            <th>{{ $t('attendance.in') }}</th>
            <th>{{ $t('attendance.out') }}</th>
            <th>{{ $t('attendance.workedCol') }}</th>
            <th>{{ $t('attendance.lateEarly') }}</th>
            <th>{{ $t('attendance.overtime') }}</th>
            <th>{{ $t('attendance.status') }}</th>
            <th v-if="canRecord || canRequestOvertime" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in period.days" :key="d.id">
            <td>{{ f.day(d.date) }}</td>
            <td>{{ d.shiftCodes ?? '—' }}</td>
            <td><span dir="ltr">{{ f.time(d.firstIn, tz) }}</span></td>
            <td><span dir="ltr">{{ f.time(d.lastOut, tz) }}</span></td>
            <td><span dir="ltr">{{ f.minutes(d.workedMinutes) }}</span></td>
            <td>
              <span v-if="d.lateMinutes" class="text-warning">{{ $t('attendance.lateN', { n: d.lateMinutes }) }}</span>
              <span v-if="d.lateMinutes && d.earlyLeaveMinutes"> · </span>
              <span v-if="d.earlyLeaveMinutes" class="text-warning">{{ $t('attendance.earlyN', { n: d.earlyLeaveMinutes }) }}</span>
              <span v-if="!d.lateMinutes && !d.earlyLeaveMinutes" class="text-medium-emphasis">—</span>
            </td>
            <td><span dir="ltr">{{ f.minutes(d.overtimeMinutes) }}</span></td>
            <td>
              <v-chip size="x-small" variant="tonal" :color="STATUS_COLOR[d.status]">{{ $t(`attendance.statuses.${d.status}`) }}</v-chip>
              <v-chip v-if="d.review !== 'NONE'" size="x-small" variant="tonal" :color="REVIEW_COLOR[d.review]" class="ms-1">
                {{ $t(`attendance.reviews.${d.review}`) }}
                <v-tooltip v-if="d.reviewedBy" activator="parent" location="top">{{ $t('attendance.reviewedBy', { name: d.reviewedBy, at: f.stamp(d.reviewedAt) }) }}<template v-if="d.reviewNote"> — {{ d.reviewNote }}</template></v-tooltip>
              </v-chip>
            </td>
            <td v-if="canRecord || canRequestOvertime">
              <v-btn v-if="canRecord && fixable(d)" size="x-small" variant="text" color="primary" @click="openRecord(d.date.slice(0, 10))">{{ $t('attendance.recordShort') }}</v-btn>
              <v-btn v-if="canRequestOvertime && d.overtimeMinutes > 0 && !d.locked" size="x-small" variant="text" @click="openOvertime(d.date.slice(0, 10), d.overtimeMinutes)">{{ $t('attendance.addOvertime') }}</v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <v-row>
    <!-- Punches -->
    <v-col cols="12" md="6">
      <v-card :title="$t('attendance.punchesTitle')" class="mb-4">
        <v-card-text>
          <div v-if="punches.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('attendance.noPunches') }}</div>
          <div v-for="p in punches" :key="p.id" class="d-flex align-center ga-2 py-2 rrow">
            <v-icon :icon="p.kind === 'IN' ? 'log-in' : 'log-out'" size="18" :color="p.kind === 'IN' ? 'success' : undefined" />
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-2">
                {{ p.kind === 'IN' ? $t('attendance.in') : $t('attendance.out') }} · {{ f.day(new Date(p.at).toLocaleDateString('en-CA', { timeZone: tz })) }}
                <b dir="ltr" class="ms-1">{{ f.time(p.at, tz) }}</b>
                <v-chip size="x-small" variant="tonal" class="ms-1">{{ $t(`attendance.sources.${p.source}`) }}</v-chip>
              </div>
              <div v-if="p.createdBy || p.note" class="text-caption text-medium-emphasis">
                <template v-if="p.createdBy">{{ $t('attendance.enteredBy', { name: p.createdBy }) }}</template>
                <template v-if="p.createdBy && p.note"> · </template>
                <template v-if="p.note">{{ p.note }}</template>
              </div>
            </div>
            <v-btn v-if="canRecord && p.source === 'MANUAL'" icon="trash-2" size="x-small" variant="text" color="error" :aria-label="$t('attendance.deletePunch')" @click="removePunch(p)" />
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Overtime -->
    <v-col cols="12" md="6">
      <v-card :title="$t('attendance.overtimeTitle')" class="mb-4">
        <v-card-text>
          <div v-if="!period || period.overtime.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('attendance.noOvertime') }}</div>
          <div v-for="o in period?.overtime ?? []" :key="o.id" class="d-flex align-center flex-wrap ga-2 py-2 rrow">
            <v-icon icon="timer" size="18" />
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-2 font-weight-medium">
                {{ f.day(o.date) }} · <span dir="ltr">{{ f.minutes(o.minutes) }}</span>
                <span v-if="o.status === 'APPROVED' && o.approvedMinutes !== o.minutes"> → <span dir="ltr">{{ f.minutes(o.approvedMinutes) }}</span></span>
                <v-chip size="x-small" variant="tonal" :color="REQUEST_COLOR[o.status]" class="ms-1">{{ $t(`attendance.requestStatuses.${o.status}`) }}</v-chip>
              </div>
              <div class="text-caption text-medium-emphasis">{{ o.reason }}<template v-if="o.requestedBy"> · {{ $t('attendance.enteredBy', { name: o.requestedBy }) }}</template></div>
              <div v-if="o.decidedBy" class="text-caption text-medium-emphasis">
                {{ $t('attendance.decidedBy', { name: o.decidedBy, at: f.stamp(o.decidedAt) }) }}<template v-if="o.decisionNote"> — {{ o.decisionNote }}</template>
              </div>
            </div>
            <v-btn v-if="canRequestOvertime && o.status === 'PENDING'" size="small" variant="text" color="error" @click="withdraw(o)">{{ $t('attendance.withdraw') }}</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <!-- Record in / out -->
  <v-dialog v-model="recDialog" max-width="480">
    <v-card :title="$t('attendance.record')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="recForm" />
        <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('attendance.recordHint') }}</p>
        <v-form :ref="recForm.bind" @submit.prevent="saveRecord">
          <v-text-field v-model="rec.date" type="date" :label="$t('attendance.date') + ' *'" :rules="[rules.required, rules.date]" :error-messages="recForm.errorsFor('date')" />
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="rec.inTime" type="time" :label="$t('attendance.in')" :error-messages="recForm.errorsFor('inTime')" /></v-col>
            <v-col cols="6"><v-text-field v-model="rec.outTime" type="time" :label="$t('attendance.out')" :hint="$t('attendance.nextDayHint')" persistent-hint :error-messages="recForm.errorsFor('outTime')" /></v-col>
          </v-row>
          <v-text-field v-model="rec.note" :label="$t('attendance.note')" :error-messages="recForm.errorsFor('note')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="recDialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="recForm.busy.value" @click="saveRecord">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Overtime -->
  <v-dialog v-model="otDialog" max-width="480">
    <v-card :title="$t('attendance.addOvertime')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="otForm" />
        <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('attendance.overtimeHint') }}</p>
        <v-form :ref="otForm.bind" @submit.prevent="saveOvertime">
          <v-text-field v-model="ot.date" type="date" :label="$t('attendance.date') + ' *'" :rules="[rules.required, rules.date]" :error-messages="otForm.errorsFor('date')" />
          <v-row dense>
            <v-col cols="6"><v-text-field v-model.number="ot.hours" type="number" min="0" max="12" :label="$t('attendance.hours')" /></v-col>
            <v-col cols="6"><v-text-field v-model.number="ot.mins" type="number" min="0" max="59" step="5" :label="$t('attendance.minutes')" :error-messages="otForm.errorsFor('minutes')" /></v-col>
          </v-row>
          <v-textarea v-model="ot.reason" :label="$t('attendance.reason') + ' *'" rows="2" auto-grow :rules="[rules.required]" :error-messages="otForm.errorsFor('reason')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="otDialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="otForm.busy.value" @click="saveOvertime">{{ $t('attendance.send') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.att-table td, .att-table th { white-space: nowrap; }
.rrow + .rrow { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
