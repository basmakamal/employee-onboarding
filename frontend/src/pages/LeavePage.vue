<script setup lang="ts">
/**
 * Leave across the company (a branch manager: their branches), waiting
 * requests first by default. The approver sees the days, how they are paid
 * and — for a type with a balance — what is left, then approves or rejects
 * with a note; the decision records who made it. Leave is entered on the
 * employee file (Leave tab).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useOrgOptions } from '../composables/useOrgOptions';
import { useForm } from '../composables/useForm';
import { useApprovalCount } from '../composables/useApprovalCount';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';
import { REQUEST_COLOR, useAttendanceFormat } from '../composables/useAttendanceFormat';

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
  createdAt: string;
  balance: number | null;
  leaveType: { code: string; nameAr: string; nameEn: string; color: string | null; balanceMode: string };
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null };
}
interface LeaveType { id: string; nameAr: string; nameEn: string }

const { t } = useI18n();
const auth = useAuthStore();
const companyName = useActiveCompanyName();
const org = useOrgOptions();
const f = useAttendanceFormat();
const canDecide = computed(() => auth.can('leave.approve'));
const nameOf = (x: { nameAr: string; nameEn: string }) => (f.ar.value ? x.nameAr : x.nameEn);

const status = ref<string | null>('PENDING');
const typeId = ref<string | null>(null);
const unit = ref<string | null>(null);
const q = ref('');
const page = ref(1);
const rows = ref<Req[]>([]);
const total = ref(0);
const types = ref<LeaveType[]>([]);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '25' });
    if (status.value) params.set('status', status.value);
    if (typeId.value) params.set('leaveTypeId', typeId.value);
    if (unit.value) params.set('orgUnitId', unit.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<{ items: Req[]; total: number }>(`/api/leave/requests?${params}`);
    rows.value = data.items;
    total.value = data.total;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  void org.load();
  void load();
  try {
    types.value = await api.get<LeaveType[]>('/api/leave/types');
  } catch {
    /* the filter simply stays empty */
  }
});
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => ((page.value = 1), void load()), 300);
});
watch([status, typeId, unit], () => ((page.value = 1), void load()));
watch(page, () => void load());

const range = (r: Req) => (r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? f.day(r.startDate, true) : `${f.day(r.startDate)} – ${f.day(r.endDate, true)}`);
const pay = (p: PayPart[] | null) => (p ?? []).map((x) => t('leave.payPart', { days: x.days, percent: x.percent })).join(' · ');

const dialog = ref({ show: false, approve: true, row: null as Req | null, note: '' });
const form = useForm();
function openDecision(row: Req, approve: boolean) {
  form.reset();
  dialog.value = { show: true, approve, row, note: '' };
}
function saveDecision() {
  return form.submit(async () => {
    const d = dialog.value;
    if (!d.row) return;
    await api.post(`/api/leave/requests/${d.row.id}/decision`, { approve: d.approve, ...(d.note.trim() ? { note: d.note.trim() } : {}) });
    d.show = false;
    await Promise.all([load(), useApprovalCount().refresh()]);
  });
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('leave.pageTitle')" :subtitle="$t('leave.pageSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-select
        v-model="status"
        :items="['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ title: $t(`attendance.requestStatuses.${s}`), value: s }))"
        :label="$t('attendance.status')"
        density="compact"
        hide-details
        clearable
        style="max-width: 200px"
      />
      <v-select v-model="typeId" :items="types.map((x) => ({ title: nameOf(x), value: x.id }))" :label="$t('leave.type')" density="compact" hide-details clearable style="max-width: 220px" />
      <v-select v-model="unit" :items="org.unitItems.value" :label="$t('fields.orgUnit')" density="compact" hide-details clearable style="max-width: 240px" />
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 220px" />
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-if="!loading && rows.length === 0" icon="calendar-check" :title="$t('leave.pageEmpty')" compact />
      <div v-for="r in rows" :key="r.id" class="req pa-4">
        <div class="d-flex flex-wrap align-start ga-3">
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex flex-wrap align-center ga-2">
              <router-link :to="`/employees/${r.employee.id}?tab=leave`" class="text-body-1 font-weight-bold text-decoration-none">{{ r.employee.firstName }} {{ r.employee.lastName }}</router-link>
              <span class="text-caption text-medium-emphasis">{{ r.employee.orgUnit ? nameOf(r.employee.orgUnit) : r.employee.employeeNo }}</span>
              <v-chip size="x-small" variant="tonal" :color="REQUEST_COLOR[r.status]">{{ $t(`attendance.requestStatuses.${r.status}`) }}</v-chip>
            </div>
            <div class="text-body-2 mt-1 d-flex flex-wrap align-center ga-1">
              <span class="dot" :style="{ background: r.leaveType.color ?? '#5b3fd1' }" />
              <b>{{ nameOf(r.leaveType) }}</b> · {{ range(r) }} · <b>{{ $t('leave.nDays', { n: Number(r.days) }) }}</b><template v-if="r.halfDay"> ({{ $t('leave.halfDay') }})</template>
            </div>
            <div class="text-caption text-medium-emphasis mt-1">{{ pay(r.payBreakdown) }}</div>
            <div v-if="r.reason" class="text-body-2 text-medium-emphasis mt-1">“{{ r.reason }}”</div>
            <div class="text-caption text-medium-emphasis mt-1">{{ $t('attendance.enteredBy', { name: r.requestedBy ?? '—' }) }} · {{ f.stamp(r.createdAt) }}</div>
            <div v-if="r.balance !== null" class="evidence mt-2 text-caption">
              {{ $t('leave.balanceNow', { n: r.balance }) }} → <b>{{ $t('leave.balanceAfter', { n: Math.round((r.balance - Number(r.days)) * 100) / 100 }) }}</b>
            </div>
            <div v-if="r.decidedBy" class="text-caption mt-2">
              {{ $t('attendance.decidedBy', { name: r.decidedBy, at: f.stamp(r.decidedAt) }) }}<template v-if="r.decisionNote"> — {{ r.decisionNote }}</template>
            </div>
          </div>
          <div v-if="canDecide && r.status === 'PENDING'" class="d-flex ga-2">
            <v-btn color="success" variant="flat" size="small" prepend-icon="check" @click="openDecision(r, true)">{{ $t('attendance.approve') }}</v-btn>
            <v-btn color="error" variant="tonal" size="small" prepend-icon="x" @click="openDecision(r, false)">{{ $t('attendance.reject') }}</v-btn>
          </div>
        </div>
      </div>
      <div v-if="total > 25" class="d-flex justify-center py-2">
        <v-pagination v-model="page" :length="Math.ceil(total / 25)" density="compact" />
      </div>
    </v-card>

    <v-dialog v-model="dialog.show" max-width="460">
      <v-card :title="dialog.approve ? $t('attendance.approve') : $t('attendance.reject')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="form" />
          <p v-if="dialog.approve" class="text-body-2 text-medium-emphasis mb-3">{{ $t('leave.approveHint') }}</p>
          <v-textarea v-model="dialog.note" :label="$t('attendance.note')" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn :color="dialog.approve ? 'success' : 'error'" variant="flat" :loading="form.busy.value" @click="saveDecision">
            {{ dialog.approve ? $t('attendance.approve') : $t('attendance.reject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.req + .req { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.evidence { background: rgba(var(--v-theme-on-surface), 0.04); border-radius: 8px; padding: 6px 10px; display: inline-block; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
</style>
