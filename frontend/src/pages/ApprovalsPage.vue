<script setup lang="ts">
/**
 * Approvals: everything waiting for the signed-in approver (branch manager,
 * company manager, super admin) in one queue — leave and overtime together,
 * oldest first — and what they decided lately. Approve or reject one by one
 * with a note, or approve several at once; every decision records who made
 * it. Leave approval re-checks the balance, so a bulk approval reports the
 * requests that could not go through instead of stopping.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useApprovalCount } from '../composables/useApprovalCount';
import { useForm } from '../composables/useForm';
import { errorText } from '../validation/errors';
import { REQUEST_COLOR, STATUS_COLOR, useAttendanceFormat } from '../composables/useAttendanceFormat';

interface PayPart { days: number; percent: number }
interface Base {
  id: string;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null };
  createdAt: string;
  status: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  reason: string | null;
}
interface LeaveItem extends Base {
  kind: 'LEAVE';
  leave: { type: { code: string; nameAr: string; nameEn: string; color: string | null }; startDate: string; endDate: string; halfDay: boolean; days: number; pay: PayPart[] | null; balance: number | null };
}
interface OvertimeItem extends Base {
  kind: 'OVERTIME';
  overtime: { date: string; minutes: number; approvedMinutes: number | null; day: { status: string; firstIn: string | null; lastOut: string | null; workedMinutes: number; overtimeMinutes: number } | null };
}
type Item = LeaveItem | OvertimeItem;

const { t } = useI18n();
const companyName = useActiveCompanyName();
const approvals = useApprovalCount();
const f = useAttendanceFormat();
const nameOf = (x: { nameAr: string; nameEn: string }) => (f.ar.value ? x.nameAr : x.nameEn);

const view = ref<'WAITING' | 'DECIDED'>('WAITING');
const kind = ref<'ALL' | 'LEAVE' | 'OVERTIME'>('ALL');
const items = ref<Item[]>([]);
const kinds = ref({ leave: false, overtime: false });
const tz = ref('Asia/Riyadh');
const loading = ref(false);
const error = ref('');
const selected = ref<string[]>([]);
const keyOf = (i: Item) => `${i.kind}:${i.id}`;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ view: view.value });
    if (kind.value !== 'ALL') params.set('kind', kind.value);
    const data = await api.get<{ items: Item[]; kinds: { leave: boolean; overtime: boolean }; timezone: string }>(`/api/approvals?${params}`);
    items.value = data.items;
    kinds.value = data.kinds;
    tz.value = data.timezone;
    selected.value = selected.value.filter((k) => data.items.some((i) => keyOf(i) === k));
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => void load());
watch([view, kind], () => {
  selected.value = [];
  void load();
});

const range = (l: LeaveItem['leave']) =>
  l.startDate.slice(0, 10) === l.endDate.slice(0, 10) ? f.day(l.startDate, true) : `${f.day(l.startDate)} – ${f.day(l.endDate, true)}`;
const pay = (p: PayPart[] | null) => (p ?? []).map((x) => t('leave.payPart', { days: x.days, percent: x.percent })).join(' · ');
const waitingFor = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? t('approvals.today') : t('approvals.daysAgo', { n: days });
};
const allSelected = computed({
  get: () => items.value.length > 0 && selected.value.length === items.value.length,
  set: (v: boolean) => (selected.value = v ? items.value.map(keyOf) : []),
});

// ─────────────────────────────────────── decide one
const dialog = ref({ show: false, approve: true, item: null as Item | null, note: '', hours: 0, mins: 0 });
const form = useForm();
function open(item: Item, approve: boolean) {
  form.reset();
  const m = item.kind === 'OVERTIME' ? item.overtime.minutes : 0;
  dialog.value = { show: true, approve, item, note: '', hours: Math.floor(m / 60), mins: m % 60 };
}
function decide(item: Item, approve: boolean, note: string, minutes?: number) {
  const body = { approve, ...(note.trim() ? { note: note.trim() } : {}), ...(minutes !== undefined ? { approvedMinutes: minutes } : {}) };
  return item.kind === 'LEAVE'
    ? api.post(`/api/leave/requests/${item.id}/decision`, body)
    : api.post(`/api/attendance/overtime/${item.id}/decision`, body);
}
function save() {
  return form.submit(async () => {
    const d = dialog.value;
    if (!d.item) return;
    const minutes = d.item.kind === 'OVERTIME' && d.approve ? Number(d.hours) * 60 + Number(d.mins) : undefined;
    await decide(d.item, d.approve, d.note, minutes);
    d.show = false;
    await Promise.all([load(), approvals.refresh()]);
  });
}

// ─────────────────────────────────────── approve several
const bulkBusy = ref(false);
const bulkResult = ref<{ ok: number; failed: Array<{ name: string; reason: string }> } | null>(null);
async function approveSelected() {
  bulkBusy.value = true;
  bulkResult.value = null;
  const result = { ok: 0, failed: [] as Array<{ name: string; reason: string }> };
  for (const key of selected.value) {
    const item = items.value.find((i) => keyOf(i) === key);
    if (!item) continue;
    try {
      await decide(item, true, '');
      result.ok += 1;
    } catch (e) {
      result.failed.push({ name: `${item.employee.firstName} ${item.employee.lastName}`, reason: errorText(e) });
    }
  }
  bulkResult.value = result;
  bulkBusy.value = false;
  selected.value = [];
  await Promise.all([load(), approvals.refresh()]);
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('approvals.title')" :subtitle="$t('approvals.subtitle', { company: companyName })" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-btn-toggle v-model="view" mandatory density="compact" variant="outlined" color="primary">
        <v-btn value="WAITING" prepend-icon="clock">
          {{ $t('approvals.waiting') }}
          <v-badge v-if="approvals.count.value.total" :content="approvals.count.value.total" color="warning" inline />
        </v-btn>
        <v-btn value="DECIDED" prepend-icon="check-check">{{ $t('approvals.decided') }}</v-btn>
      </v-btn-toggle>
      <v-chip-group v-if="kinds.leave && kinds.overtime" v-model="kind" mandatory selected-class="text-primary" class="ms-1">
        <v-chip value="ALL" variant="outlined" size="small">{{ $t('approvals.all') }}</v-chip>
        <v-chip value="LEAVE" variant="outlined" size="small">{{ $t('leave.pageTitle') }}<template v-if="approvals.count.value.leave"> · {{ approvals.count.value.leave }}</template></v-chip>
        <v-chip value="OVERTIME" variant="outlined" size="small">{{ $t('attendance.overtimeTitle') }}<template v-if="approvals.count.value.overtime"> · {{ approvals.count.value.overtime }}</template></v-chip>
      </v-chip-group>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <v-alert v-if="bulkResult" :type="bulkResult.failed.length ? 'warning' : 'success'" variant="tonal" density="compact" closable class="mb-4" @click:close="bulkResult = null">
      {{ $t('approvals.bulkDone', { n: bulkResult.ok }) }}
      <ul v-if="bulkResult.failed.length" class="mt-1 ps-4">
        <li v-for="(x, i) in bulkResult.failed" :key="i">{{ x.name }} — {{ x.reason }}</li>
      </ul>
    </v-alert>

    <v-card>
      <div v-if="view === 'WAITING' && items.length" class="d-flex align-center flex-wrap ga-2 px-4 py-2 bar">
        <v-checkbox-btn v-model="allSelected" :aria-label="$t('approvals.selectAll')" />
        <span class="text-body-2 flex-grow-1">{{ selected.length ? $t('approvals.selectedN', { n: selected.length }) : $t('approvals.selectAll') }}</span>
        <v-btn v-if="selected.length" color="success" variant="flat" size="small" prepend-icon="check" :loading="bulkBusy" @click="approveSelected">
          {{ $t('approvals.approveSelected', { n: selected.length }) }}
        </v-btn>
      </div>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState
        v-if="!loading && items.length === 0"
        icon="check-check"
        :title="view === 'WAITING' ? $t('approvals.emptyWaiting') : $t('approvals.emptyDecided')"
        compact
      />

      <div v-for="item in items" :key="keyOf(item)" class="req d-flex align-start ga-3 pa-4">
        <v-checkbox-btn v-if="view === 'WAITING'" v-model="selected" :value="keyOf(item)" class="mt-n2" />
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex flex-wrap align-center ga-2">
            <v-chip size="x-small" variant="flat" :color="item.kind === 'LEAVE' ? 'primary' : 'secondary'">
              {{ item.kind === 'LEAVE' ? $t('leave.tab') : $t('attendance.overtime') }}
            </v-chip>
            <router-link :to="`/employees/${item.employee.id}?tab=${item.kind === 'LEAVE' ? 'leave' : 'attendance'}`" class="text-body-1 font-weight-bold text-decoration-none">
              {{ item.employee.firstName }} {{ item.employee.lastName }}
            </router-link>
            <span class="text-caption text-medium-emphasis">{{ item.employee.orgUnit ? nameOf(item.employee.orgUnit) : item.employee.employeeNo }}</span>
            <v-chip v-if="view === 'DECIDED'" size="x-small" variant="tonal" :color="REQUEST_COLOR[item.status]">{{ $t(`attendance.requestStatuses.${item.status}`) }}</v-chip>
            <span v-else class="text-caption text-medium-emphasis ms-auto">{{ waitingFor(item.createdAt) }}</span>
          </div>

          <!-- Leave -->
          <template v-if="item.kind === 'LEAVE'">
            <div class="text-body-2 mt-1 d-flex flex-wrap align-center ga-1">
              <span class="dot" :style="{ background: item.leave.type.color ?? '#5b3fd1' }" />
              <b>{{ nameOf(item.leave.type) }}</b> · {{ range(item.leave) }} · <b>{{ $t('leave.nDays', { n: item.leave.days }) }}</b>
              <template v-if="item.leave.halfDay"> ({{ $t('leave.halfDay') }})</template>
            </div>
            <div class="text-caption text-medium-emphasis">{{ pay(item.leave.pay) }}</div>
            <div v-if="item.leave.balance !== null" class="evidence mt-2 text-caption">
              {{ $t('leave.balanceNow', { n: item.leave.balance }) }} → <b>{{ $t('leave.balanceAfter', { n: Math.round((item.leave.balance - item.leave.days) * 100) / 100 }) }}</b>
            </div>
          </template>

          <!-- Overtime -->
          <template v-else>
            <div class="text-body-2 mt-1">
              <b>{{ f.day(item.overtime.date, true) }}</b> · {{ $t('attendance.askedFor') }} <b dir="ltr">{{ f.minutes(item.overtime.minutes) }}</b>
              <template v-if="item.status === 'APPROVED'"> · {{ $t('attendance.approvedN') }} <b dir="ltr">{{ f.minutes(item.overtime.approvedMinutes) }}</b></template>
            </div>
            <div class="evidence mt-2 text-caption">
              <template v-if="item.overtime.day">
                <v-chip size="x-small" variant="tonal" :color="STATUS_COLOR[item.overtime.day.status]" class="me-1">{{ $t(`attendance.statuses.${item.overtime.day.status}`) }}</v-chip>
                {{ $t('attendance.in') }} <span dir="ltr">{{ f.time(item.overtime.day.firstIn, tz) }}</span> ·
                {{ $t('attendance.out') }} <span dir="ltr">{{ f.time(item.overtime.day.lastOut, tz) }}</span> ·
                {{ $t('attendance.overtime') }} <span dir="ltr">{{ f.minutes(item.overtime.day.overtimeMinutes) }}</span>
              </template>
              <template v-else>{{ $t('attendance.notJudgedYet') }}</template>
            </div>
          </template>

          <div v-if="item.reason" class="text-body-2 text-medium-emphasis mt-1">“{{ item.reason }}”</div>
          <div class="text-caption text-medium-emphasis mt-1">{{ $t('attendance.enteredBy', { name: item.requestedBy ?? '—' }) }} · {{ f.stamp(item.createdAt) }}</div>
          <div v-if="item.decidedBy" class="text-caption mt-1">
            {{ $t('attendance.decidedBy', { name: item.decidedBy, at: f.stamp(item.decidedAt) }) }}<template v-if="item.decisionNote"> — {{ item.decisionNote }}</template>
          </div>
        </div>
        <div v-if="view === 'WAITING'" class="d-flex flex-column ga-2">
          <v-btn color="success" variant="flat" size="small" prepend-icon="check" @click="open(item, true)">{{ $t('attendance.approve') }}</v-btn>
          <v-btn color="error" variant="tonal" size="small" prepend-icon="x" @click="open(item, false)">{{ $t('attendance.reject') }}</v-btn>
        </div>
      </div>
    </v-card>

    <v-dialog v-model="dialog.show" max-width="460">
      <v-card :title="dialog.approve ? $t('attendance.approve') : $t('attendance.reject')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="form" />
          <template v-if="dialog.approve && dialog.item?.kind === 'OVERTIME'">
            <p class="text-body-2 text-medium-emphasis mb-1">{{ $t('attendance.approveOvertimeHint') }}</p>
            <v-row dense>
              <v-col cols="6"><v-text-field v-model.number="dialog.hours" type="number" min="0" max="12" :label="$t('attendance.hours')" /></v-col>
              <v-col cols="6"><v-text-field v-model.number="dialog.mins" type="number" min="0" max="59" step="5" :label="$t('attendance.minutes')" :error-messages="form.errorsFor('approvedMinutes')" /></v-col>
            </v-row>
          </template>
          <p v-else-if="dialog.approve" class="text-body-2 text-medium-emphasis mb-3">{{ $t('leave.approveHint') }}</p>
          <v-textarea v-model="dialog.note" :label="$t('attendance.note')" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn :color="dialog.approve ? 'success' : 'error'" variant="flat" :loading="form.busy.value" @click="save">
            {{ dialog.approve ? $t('attendance.approve') : $t('attendance.reject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.bar { border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.req + .req { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.evidence { background: rgba(var(--v-theme-on-surface), 0.04); border-radius: 8px; padding: 6px 10px; display: inline-block; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
</style>
